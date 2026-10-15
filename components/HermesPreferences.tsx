"use client";

import { useHermesI18n } from "@/hooks/useHermesI18n";
import { useTheme, type ThemePreference } from "@/hooks/useTheme";
import { useFontPreferences } from "@/hooks/useFontPreferences";
import { useHermesFontSizes } from "@/hooks/useHermesFontSizes";
import { useChatAppearance } from "@/hooks/useChatAppearance";
import { useEnterSendMode, setEnterSendMode } from "@/hooks/useEnterSendMode";
import { FONT_FAMILY_MAX_LENGTH } from "@/lib/font-preferences";
import { ConfigButton } from "./SettingsUi";
import { ConfigSwitch } from "./SettingsUi";
import { useHermesChatDisplay } from "@/hooks/useHermesChatDisplay";
import { HermesAccountSettings } from "./HermesAccountSettings";

const themes: { id: ThemePreference; label: string; description: string }[] = [
  { id: "auto", label: "跟随系统", description: "随设备自动切换浅色和深色。" },
  { id: "light", label: "浅色", description: "简洁明亮的白色界面。" },
  { id: "dark", label: "深色", description: "柔和的深色背景，适合夜间使用。" },
  { id: "mist", label: "薄雾", description: "清淡的灰蓝色，安静柔和。" },
  { id: "rose", label: "玫瑰", description: "温暖的浅粉色与玫瑰色点缀。" },
  { id: "pine", label: "松林", description: "沉静的深绿色与自然色调。" },
];

export function HermesGeneralPreferences() {
  const { ht, locale, setLocale, supportedLocales, t } = useHermesI18n();
  const sendMode = useEnterSendMode();
  return <div className="hermes-preferences-page"><label className="hermes-preference-row"><div><strong>{t("common.language")}</strong><p>{ht("设置界面语言，选择会保存在当前浏览器。")}</p></div><select aria-label={t("common.language")} value={locale} onChange={event => setLocale(event.target.value as typeof locale)}>{supportedLocales.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="hermes-preference-row"><div><strong>{ht("发送快捷键")}</strong><p>{ht("选择发送消息的按键组合。")}</p></div><select aria-label={ht("发送快捷键")} value={sendMode} onChange={event => setEnterSendMode(event.target.value as typeof sendMode)}><option value="enter">{ht("Enter 发送")}</option><option value="ctrlEnter">{ht("Ctrl / ⌘ + Enter 发送")}</option></select></label><HermesAccountSettings /></div>;
}

export function HermesThemePreferences() {
  const { ht } = useHermesI18n();
  const { preference, theme, setThemePreference } = useTheme();
  return <div className="hermes-preferences-page"><p className="hermes-preference-intro">{ht("选择喜欢的配色，点击卡片立即应用。")}</p><div className="hermes-theme-grid">{themes.map(item => <button key={item.id} type="button" className="hermes-theme-card" aria-label={ht(item.label)} aria-pressed={preference === item.id} onClick={() => setThemePreference(item.id)}><div className="hermes-theme-skeleton" data-theme={item.id === "auto" ? theme : item.id} aria-hidden="true"><div className="hermes-theme-mini-sidebar"><i /><i /><i /></div><div className="hermes-theme-mini-chat"><div className="hermes-theme-mini-heading" /><div className="hermes-theme-mini-line" /><div className="hermes-theme-mini-bubble" /><div className="hermes-theme-mini-line short" /><div className="hermes-theme-mini-input"><i /></div></div></div><div className="hermes-theme-card-label"><strong>{ht(item.label)}</strong>{preference === item.id && <span aria-hidden="true">✓</span>}</div><p>{ht(item.description)}</p></button>)}</div></div>;
}

function SizeRow({ label, description, value, min, max, onChange, unit = "px" }: { label: string; description: string; value: number; min: number; max: number; onChange: (value: number) => void; unit?: string }) {
  return <div className="hermes-preference-row"><div><strong>{label}</strong><p>{description}</p></div><div className="hermes-pixel-slider"><output>{value} {unit}</output><input type="range" aria-label={label} aria-valuetext={`${value} ${unit}`} min={min} max={max} step={1} value={value} onChange={event => onChange(Number(event.target.value))} /></div></div>;
}

export function HermesChatDisplayPreferences() {
  const { ht } = useHermesI18n();
  const display = useHermesChatDisplay();
  const switches = [
    { key: "showReasoning", label: "显示推理过程", description: "模型提供推理内容时，单独显示在回复之前。" },
    { key: "collapseReasoning", label: "默认折叠推理过程", description: "保留推理内容，点击后展开查看。" },
    { key: "toolDetails", label: "显示工具调用详情", description: "开启后显示工具预览内容；关闭时只显示工具名称。" },
  ] as const;
  return <div className="hermes-preferences-page">{switches.map(item => <div key={item.key} className="hermes-preference-row"><div><strong>{ht(item.label)}</strong><p>{ht(item.description)}</p></div><ConfigSwitch label={ht(item.label)} checked={display[item.key]} onChange={value => display.set(item.key, value)} /></div>)}<label className="hermes-preference-row"><div><strong>{ht("文字方向")}</strong><p>{ht("调整消息与输入框的文字方向，代码始终从左到右显示。")}</p></div><select aria-label={ht("文字方向")} value={display.direction} onChange={event => display.set("direction", event.target.value as typeof display.direction)}><option value="auto">{ht("自动")}</option><option value="ltr">{ht("从左到右")}</option><option value="rtl">{ht("从右到左")}</option></select></label><SizeRow label={ht("消息气泡透明度")} description={ht("0 为不透明，100 为完全透明，消息文字保持清晰。")} min={0} max={100} value={display.bubbleTransparency} unit="%" onChange={value => display.set("bubbleTransparency", value)} /></div>;
}

export function HermesFontPreferences() {
  const { ht, t } = useHermesI18n();
  const fonts = useFontPreferences();
  const sizes = useHermesFontSizes();
  const chat = useChatAppearance();
  return <div className="hermes-preferences-page"><section className="hermes-font-section"><h3>{ht("字体")}</h3><p className="hermes-preference-intro">{ht("使用本机已安装的字体；留空使用默认字体。")}</p>{(["ui", "mono"] as const).map(kind => <label className="hermes-preference-row" key={kind}><div><strong>{t(kind === "ui" ? "settings.uiFontFamily" : "settings.monoFontFamily")}</strong><p>{ht(kind === "ui" ? "用于界面和普通聊天文本。" : "用于代码和工具输出。")}</p></div><input type="text" aria-label={t(kind === "ui" ? "settings.uiFontFamily" : "settings.monoFontFamily")} value={fonts[kind]} maxLength={FONT_FAMILY_MAX_LENGTH} autoComplete="off" spellCheck={false} placeholder={ht("系统默认")} onChange={event => fonts.setFontPreference(kind, event.target.value)} /></label>)}</section><section className="hermes-font-section"><h3>{ht("字号与宽度")}</h3><SizeRow label={ht("界面字号")} description={ht("调整菜单、设置和界面文字的大小。")} min={12} max={20} value={sizes.ui} onChange={value => sizes.setSize("ui", value)} /><SizeRow label={ht("聊天字号")} description={ht("调整消息和输入框的文字大小。")} min={12} max={24} value={chat.fontSize} onChange={chat.setFontSize} /><SizeRow label={ht("代码字号")} description={ht("调整代码块和工具输出的文字大小。")} min={10} max={22} value={sizes.code} onChange={value => sizes.setSize("code", value)} /><SizeRow label={ht("内容宽度")} description={ht("调整对话内容的最大显示宽度。")} min={820} max={2000} value={chat.width} onChange={chat.setWidth} /></section><section className="hermes-font-preview"><h3>{ht("实时预览")}</h3><p style={{ fontSize: `${chat.fontSize}px` }}>{ht("清晰的文字，让对话更舒服。")}</p><pre style={{ fontSize: `${sizes.code}px` }}>const greeting = &quot;Hello, Hermes!&quot;;</pre></section><ConfigButton variant="ghost" onClick={() => { fonts.resetFontPreference("ui"); fonts.resetFontPreference("mono"); sizes.setSize("ui", 14); sizes.setSize("code", 13); chat.setFontSize(14); chat.setWidth(820); }}>{ht("还原字体与缩放")}</ConfigButton></div>;
}
