import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  LINE_HEIGHT_STEP,
  clampLineHeight
} from '@/core/reading'
import { FONT_FAMILIES, PAGE_WIDTHS } from '@/core/typography'
import { useReaderStore } from '@/store/reader'
import { useSettingsStore } from '@/store/settings'

/** 每日目标的几个档位；0 = 关闭（0.1.4）。 */
const GOAL_CHOICES: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: '关' },
  { value: 15, label: '15 分' },
  { value: 30, label: '30 分' },
  { value: 60, label: '60 分' }
]

/** 设置面板：字号 / 行距 / 字重 / 字体 / 宽度 / 主题 / 每日目标。改字号只重排版，进度按字符偏移保持不动（TECH.md 6.4）。 */
export function SettingsSheet(): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const apply = useSettingsStore((s) => s.apply)
  const open = useReaderStore((s) => s.sheetOpen)
  const setSheet = useReaderStore((s) => s.setSheet)

  return (
    <>
      {/*
        点面板外的空白处也能关（用户 2026-10-09：以前只能点「完成」或再点 Aa）。
        与目录抽屉同款 scrim（z-index 30 < 面板的 40），开着才吃鼠标事件。
      */}
      <div className={open ? 'scrim on' : 'scrim'} onClick={() => setSheet(false)} />
      <div className={open ? 'sheet on' : 'sheet'} id="settings-sheet" aria-hidden={!open}>
      <div className="sheet-row">
        <span className="label">字号</span>
        <div className="grow">
          <div className="stepper">
            <button
              id="fs-minus"
              aria-label="减小字号"
              disabled={settings.fontSize <= FONT_SIZE_MIN}
              onClick={() => apply({ fontSize: settings.fontSize - 1 })}
            >
              A－
            </button>
            <span id="fs-value">{settings.fontSize}</span>
            <button
              id="fs-plus"
              aria-label="增大字号"
              disabled={settings.fontSize >= FONT_SIZE_MAX}
              onClick={() => apply({ fontSize: settings.fontSize + 1 })}
            >
              A＋
            </button>
          </div>
        </div>
      </div>

      <div className="sheet-row">
        <span className="label">行距</span>
        <div className="grow">
          {/* 0.2.2：三档固定值改成步进微调（1.20–3.00，每步 0.05）。
              clampLineHeight 负责夹范围 + 吸附 0.05 网格，浮点加减不会攒误差。 */}
          <div className="stepper">
            <button
              id="lh-minus"
              aria-label="减小行距"
              disabled={settings.lineHeight <= LINE_HEIGHT_MIN}
              onClick={() => apply({ lineHeight: clampLineHeight(settings.lineHeight - LINE_HEIGHT_STEP) })}
            >
              －
            </button>
            <span id="lh-value">{settings.lineHeight.toFixed(2)}</span>
            <button
              id="lh-plus"
              aria-label="增大行距"
              disabled={settings.lineHeight >= LINE_HEIGHT_MAX}
              onClick={() => apply({ lineHeight: clampLineHeight(settings.lineHeight + LINE_HEIGHT_STEP) })}
            >
              ＋
            </button>
          </div>
        </div>
      </div>

      <div className="sheet-row">
        <span className="label">字重</span>
        <div className="grow">
          <button
            className={settings.bold ? 'pill' : 'pill on'}
            id="bold-off"
            data-bold-choice="off"
            onClick={() => apply({ bold: false })}
          >
            常规
          </button>
          <button
            className={settings.bold ? 'pill on' : 'pill'}
            id="bold-on"
            data-bold-choice="on"
            onClick={() => apply({ bold: true })}
          >
            加粗
          </button>
        </div>
      </div>

      <div className="sheet-row">
        <span className="label">字体</span>
        <div className="grow">
          {FONT_FAMILIES.map((item) => (
            <button
              key={item.value}
              id={'font-' + item.value}
              className={settings.fontFamily === item.value ? 'pill on' : 'pill'}
              data-font={item.value}
              onClick={() => apply({ fontFamily: item.value })}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="sheet-row">
        <span className="label">宽度</span>
        <div className="grow">
          {PAGE_WIDTHS.map((item) => (
            <button
              key={item.value}
              id={'width-' + item.value}
              className={settings.pageWidth === item.value ? 'pill on' : 'pill'}
              data-width={item.value}
              onClick={() => apply({ pageWidth: item.value })}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="sheet-row">
        <span className="label">主题</span>
        <div className="grow">
          <button
            className={settings.theme === 'day' ? 'pill on' : 'pill'}
            data-theme-choice="day"
            onClick={() => apply({ theme: 'day' })}
          >
            日间
          </button>
          <button
            className={settings.theme === 'night' ? 'pill on' : 'pill'}
            data-theme-choice="night"
            onClick={() => apply({ theme: 'night' })}
          >
            夜间
          </button>
        </div>
      </div>

      <div className="sheet-row">
        <span className="label">每日目标</span>
        <div className="grow">
          {GOAL_CHOICES.map((item) => (
            <button
              key={item.value}
              id={'goal-' + item.value}
              className={settings.dailyGoalMinutes === item.value ? 'pill on' : 'pill'}
              data-goal={item.value}
              onClick={() => apply({ dailyGoalMinutes: item.value })}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="sheet-hint">
        调字号会让正文重新排版，但<b>阅读位置不变</b> —— 这就是进度不用「第几页」记录的原因。
        <br />
        <b>← →</b> 翻页 · <b>Ctrl + ← →</b> 切换章节 · <b>Esc</b> 关面板 / 返回书架
        <br />
        行距可在 1.20 – 3.00 之间按 0.05 微调。
        <br />
        每日目标只管显示：达标后书架那行会写「已达标」，不做提醒、不弹窗。
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={() => setSheet(false)}>
          完成
        </button>
      </div>
      </div>
    </>
  )
}
