import { LINE_HEIGHTS } from '@/core/reading'
import { useReaderStore } from '@/store/reader'
import { useSettingsStore } from '@/store/settings'

const LINE_HEIGHT_LABELS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1.6, label: '紧凑' },
  { value: 1.9, label: '标准' },
  { value: 2.25, label: '宽松' }
]

/** 设置面板：字号 / 行距 / 主题。改字号只重排版，进度按字符偏移保持不动（TECH.md 6.4）。 */
export function SettingsSheet(): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const apply = useSettingsStore((s) => s.apply)
  const open = useReaderStore((s) => s.sheetOpen)
  const setSheet = useReaderStore((s) => s.setSheet)

  return (
    <div className={open ? 'sheet on' : 'sheet'} id="settings-sheet" aria-hidden={!open}>
      <div className="sheet-row">
        <span className="label">字号</span>
        <div className="grow">
          <div className="stepper">
            <button
              id="fs-minus"
              aria-label="减小字号"
              disabled={settings.fontSize <= 15}
              onClick={() => apply({ fontSize: settings.fontSize - 1 })}
            >
              A－
            </button>
            <span id="fs-value">{settings.fontSize}</span>
            <button
              id="fs-plus"
              aria-label="增大字号"
              disabled={settings.fontSize >= 27}
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
          {LINE_HEIGHT_LABELS.map((item) => (
            <button
              key={item.value}
              className={Math.abs(settings.lineHeight - item.value) < 0.01 ? 'pill on' : 'pill'}
              data-lh={item.value}
              onClick={() => apply({ lineHeight: item.value })}
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

      <div className="sheet-hint">
        调字号会让正文重新排版，但<b>阅读位置不变</b> —— 这就是进度不用「第几页」记录的原因。
        <br />
        <b>← →</b> 切换章节 · <b>Esc</b> 关面板 / 返回书架
        <br />
        行距可选：{LINE_HEIGHTS.join(' / ')}
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={() => setSheet(false)}>
          完成
        </button>
      </div>
    </div>
  )
}
