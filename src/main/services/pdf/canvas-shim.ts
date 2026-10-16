/**
 * 给 pdfjs 的最小 canvas 替身（0.4.0）。
 *
 * 为什么需要：pdfjs 在 Node 环境下加载时会 `require('@napi-rs/canvas')`，为的是拿它的
 * `DOMMatrix` / `ImageData` 当全局 polyfill（还顺手 `new DOMMatrix()` 建了个模块级常量）。
 * 而那个包自带的 skia 原生模块在 Electron 里加载会**把进程打崩**：Windows 错误报告里是
 * `BEX64`、故障模块 `skia.win32-x64-msvc.node`、异常代码 `c0000005`，用户看到的是
 * 「十二阅读 has stopped working」。
 *
 * 我们只抽文字，压根不用 canvas —— 但 pdfjs 模块顶层就要 `new DOMMatrix()`，
 * 光把依赖掏空会直接 `ReferenceError: DOMMatrix is not defined`。所以给一份**纯 JS 的替身**：
 * pdfjs 会从 `canvas.DOMMatrix` 取到它当 polyfill，不再需要任何原生模块。
 *
 * 只实现 2D 仿射部分（a b c d e f）—— PDF 的文字层抽取用不到 3D，
 * 真正要用 3D 的只有渲染路径，而渲染路径在本应用里不会走到。
 */

const DEG_TO_RAD = Math.PI / 180

export interface MatrixLike {
  a?: number
  b?: number
  c?: number
  d?: number
  e?: number
  f?: number
}

/** 行向量约定：点 p 变换后 = p · M，M 的 2D 部分是 [[a,b,0],[c,d,0],[e,f,1]]。 */
export class DOMMatrixShim {
  a = 1
  b = 0
  c = 0
  d = 1
  e = 0
  f = 0

  constructor(init?: string | number[] | MatrixLike) {
    if (init === undefined) return
    if (typeof init === 'string') {
      const values = init
        .trim()
        .replace(/^matrix\(|\)$/g, '')
        .split(/[\s,]+/)
        .map(Number)
      if (values.length >= 6) this.#set(values)
      return
    }
    if (Array.isArray(init)) {
      this.#set(init)
      return
    }
    this.a = init.a ?? 1
    this.b = init.b ?? 0
    this.c = init.c ?? 0
    this.d = init.d ?? 1
    this.e = init.e ?? 0
    this.f = init.f ?? 0
  }

  #set(values: number[]): void {
    this.a = Number(values[0] ?? 1)
    this.b = Number(values[1] ?? 0)
    this.c = Number(values[2] ?? 0)
    this.d = Number(values[3] ?? 1)
    this.e = Number(values[4] ?? 0)
    this.f = Number(values[5] ?? 0)
  }

  get is2D(): boolean {
    return true
  }

  get isIdentity(): boolean {
    return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0
  }

  /** this · other（先应用 this，再应用 other，与 DOMMatrix 的语义一致）。 */
  multiplySelf(other: DOMMatrixShim | MatrixLike): this {
    const o = new DOMMatrixShim(other)
    const { a, b, c, d, e, f } = this
    this.a = a * o.a + b * o.c
    this.b = a * o.b + b * o.d
    this.c = c * o.a + d * o.c
    this.d = c * o.b + d * o.d
    this.e = e * o.a + f * o.c + o.e
    this.f = e * o.b + f * o.d + o.f
    return this
  }

  /** other · this（把 other 放在前面，与 preMultiplySelf 一致）。 */
  preMultiplySelf(other: DOMMatrixShim | MatrixLike): this {
    const o = new DOMMatrixShim(other)
    const result = o.multiplySelf({ a: this.a, b: this.b, c: this.c, d: this.d, e: this.e, f: this.f })
    this.#set([result.a, result.b, result.c, result.d, result.e, result.f])
    return this
  }

  multiply(other: DOMMatrixShim | MatrixLike): DOMMatrixShim {
    return new DOMMatrixShim(this).multiplySelf(other)
  }

  translateSelf(tx = 0, ty = 0): this {
    this.e += tx
    this.f += ty
    return this
  }

  translate(tx = 0, ty = 0): DOMMatrixShim {
    return new DOMMatrixShim(this).translateSelf(tx, ty)
  }

  scaleSelf(scaleX = 1, scaleY = scaleX): this {
    this.a *= scaleX
    this.b *= scaleX
    this.c *= scaleY
    this.d *= scaleY
    return this
  }

  scale(scaleX = 1, scaleY = scaleX): DOMMatrixShim {
    return new DOMMatrixShim(this).scaleSelf(scaleX, scaleY)
  }

  rotateSelf(degrees = 0): this {
    const rad = degrees * DEG_TO_RAD
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    return this.multiplySelf({ a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 })
  }

  rotate(degrees = 0): DOMMatrixShim {
    return new DOMMatrixShim(this).rotateSelf(degrees)
  }

  invertSelf(): this {
    const { a, b, c, d, e, f } = this
    const det = a * d - b * c
    if (det === 0) {
      this.#set([Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN])
      return this
    }
    this.#set([d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det])
    return this
  }

  inverse(): DOMMatrixShim {
    return new DOMMatrixShim(this).invertSelf()
  }

  toFloat32Array(): Float32Array {
    return Float32Array.from([this.a, this.b, this.c, this.d, this.e, this.f])
  }

  toFloat64Array(): Float64Array {
    return Float64Array.from([this.a, this.b, this.c, this.d, this.e, this.f])
  }

  toString(): string {
    if (this.isIdentity) return 'matrix(1, 0, 0, 1, 0, 0)'
    return `matrix(${[this.a, this.b, this.c, this.d, this.e, this.f].join(', ')})`
  }

  static fromMatrix(other: MatrixLike = {}): DOMMatrixShim {
    return new DOMMatrixShim(other)
  }

  static fromFloat32Array(values: Float32Array): DOMMatrixShim {
    return new DOMMatrixShim(Array.from(values))
  }

  static fromFloat64Array(values: Float64Array): DOMMatrixShim {
    return new DOMMatrixShim(Array.from(values))
  }
}

/** 只需要能被构造出来（渲染路径才会真的读写像素）。 */
export class ImageDataShim {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number
  readonly colorSpace = 'srgb'

  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight?: number, height?: number) {
    if (typeof dataOrWidth === 'number') {
      this.width = dataOrWidth
      this.height = widthOrHeight ?? 0
      this.data = new Uint8ClampedArray(this.width * this.height * 4)
    } else {
      this.data = dataOrWidth
      this.width = widthOrHeight ?? 0
      this.height = height ?? (this.width === 0 ? 0 : Math.floor(this.data.length / 4 / this.width))
    }
  }
}

/** 塞进 require 缓存的那个「模块」导出：pdfjs 会自动用它当 polyfill。 */
export const canvasShimExports = {
  DOMMatrix: DOMMatrixShim,
  ImageData: ImageDataShim
}
