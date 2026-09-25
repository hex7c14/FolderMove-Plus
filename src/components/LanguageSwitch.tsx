import { LocalLanguage20Regular } from "@fluentui/react-icons";
import { useLocale } from "../i18n/useLocale";
import { K, useTranslation } from "../i18n";

interface Props {
  /**
   * compact = 只显示图标 + 下拉框（放在侧边栏底部）。
   * 未来做「设置」页时可以用非 compact 版本显示完整标签。
   */
  compact?: boolean;
}

/**
 * 语言切换器。
 *
 * 选项统一写成「母语名（中文名）」：中文界面下显示「English（英语）」，
 * 英文界面下显示「日本語（日语）」，任何语言下都能对上号。
 * 只有中文语言本身不重复显示括号。
 */
export function LanguageSwitch({ compact = true }: Props) {
  const { t } = useTranslation();
  const { preference, setPreference, locales } = useLocale();

  return (
    <div className="flex items-center gap-2">
      {!compact && (
        <span className="text-[11px] ink-soft shrink-0">{t(K.settings.language)}</span>
      )}
      <div className="relative flex-1 min-w-0 flex items-center">
        <LocalLanguage20Regular className="ink-soft absolute left-2 pointer-events-none w-4 h-4" />
        <select
          className="field w-full !py-1.5 !pl-7 !text-[11px] cursor-pointer"
          value={preference}
          onChange={(e) => setPreference(e.target.value as typeof preference)}
          title={t(K.settings.language)}
          aria-label={t(K.settings.language)}
        >
          <option value="system">{t(K.settings.languageSystem)}</option>
          {locales.map((l) => (
            <option key={l.code} value={l.code}>
              {l.nativeName === l.chineseName
                ? l.nativeName
                : `${l.nativeName}（${l.chineseName}）`}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
