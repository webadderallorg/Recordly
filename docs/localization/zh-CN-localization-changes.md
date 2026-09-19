# Recordly 简体中文化修改清单

本次修改目标是补齐界面中遗漏的中文、修正翻译命名空间错误，并把项目保存、导出、字幕、时间线等操作反馈接入现有 i18n 体系。

## 1. 翻译资源

| 文件与位置 | 修改前示例 | 修改后示例 |
| --- | --- | --- |
| src/i18n/locales/zh-CN/common.json 的 loading、light、dark、system、announcements | Refreshing...、Light、Dark、System | 正在刷新...、浅色、深色、跟随系统；公告关闭为 关闭 |
| src/i18n/locales/zh-CN/common.json 的 close | 通用对话框的屏幕阅读器文本为 Close | 关闭 |
| src/i18n/locales/zh-CN/dialogs.json 的 addFont | This font is already added. 等英文提示 | 此字体已添加。、取消 |
| src/i18n/locales/zh-CN/editor.json 的 annotations | Custom Fonts、Custom Color、Annotation 等英文 | 自定义字体、自定义颜色、标注，并补齐箭头方向、图片/箭头错误提示 |
| src/i18n/locales/zh-CN/editor.json 的 projectBrowser、extensions、project | Projects、Import、No preview yet、Extensions、Project saved... | 项目、导入、暂无预览、扩展、项目已保存到... |
| src/i18n/locales/zh-CN/editor.json 的 exportStatus | No video loaded、Export failed、Show in Folder 等 | 未加载视频、导出失败、在文件夹中显示等，保留 {{path}}、{{error}} 占位符 |
| src/i18n/locales/zh-CN/editor.json 的 presets、theme、captions | 预设、外观、Whisper/字幕操作存在英文或缺失键 | 补齐 已保存的预设、外观、模型选择/删除/生成字幕等中文提示 |
| src/i18n/locales/zh-CN/launch.json | 录制准备、预览更新、更新提示和选择录制源存在英文回退 | 正在准备录制、即将打开编辑器、预览更新界面、请选择要录制的源、Recordly 更新 |
| src/i18n/locales/zh-CN/settings.json | Auto、点击效果、字幕编辑、视频背景导入、颜色选择器等缺少中文 | 补齐 自动、关闭/波纹/聚光灯/回声、文本/开始/结束/拆分/合并/删除、视频背景和颜色选择器提示 |
| src/i18n/locales/zh-CN/settings.json 的 captions.languages | Auto Detect、English、Chinese (Simplified) 等固定英文 | 自动检测、英语、简体中文等 |
| src/i18n/locales/zh-CN/timeline.json | No Video Loaded、Custom、Trim、Manual 等英文 | 未加载视频、自定义、分割、手动等 |

同一批键已同步补入 de、en、es、fr、it、ko、nl、pt-BR、ru、zh-TW，以保持所有语言文件结构一致。除简体中文外，新补键先使用英文基线，后续可以分别翻译。

## 2. 代码接入位置

| 文件 | 位置/作用 | 修改前 | 修改后 |
| --- | --- | --- | --- |
| src/components/launch/popovers/MorePopover.tsx | 主题菜单 | 在 launch 作用域中读取 common.light/dark/system，键作用域不匹配 | 同时使用全局 useI18n() 和 launch 作用域，正确读取 common.* |
| src/components/launch/SourceSelector.tsx | 刷新源按钮 | Refreshing... | tCommon("common.loading", ...) |
| src/components/launch/UpdateToastWindow.tsx | 更新提示无障碍标签 | aria-label="Recordly update" | t("launch.updateToast.ariaLabel", ...) |
| src/components/video-editor/TutorialHelp.tsx | Discord 按钮标题/无障碍标签 | common.app.discord 在 editor 作用域中读取 | 改为全局 common 作用域 |
| ProjectBrowserDialog.tsx、ExtensionManager.tsx、EditorShell.tsx | 项目浏览、扩展、加载中和打开项目 | JSX 中直接写 Projects、Import、Extensions、Loading video... | 改为 editor.projectBrowser.*、editor.extensions.*、editor.loadingVideo 等翻译键 |
| TimelineEditor.tsx、timeline/components/toolbar/TimelineToolbar.tsx、timeline/Item.tsx | 时间线空状态、工具栏、片段操作 | 直接写 No Video Loaded、Pan、Zoom、Trim、Manual | 接入 timeline.empty.*、timeline.toolbar.*、timeline.item.* |
| AnnotationOverlay.tsx、AnnotationSettingsPanel.tsx | 标注占位图、字体/颜色控件 | Annotation、No image、Custom Fonts、Custom Color | 接入 editor.annotations.* |
| src/components/ui/dialog.tsx | 通用对话框关闭按钮 | 固定为 Close | 接入 common.close |
| SettingsPanel.tsx | 视频背景导入、颜色按钮、DEV 标记、字幕语言 | Unsupported format、Pick、Custom color picker、固定英文语言名 | 接入 settings.background.*、settings.effects.*、settings.captions.languages.* |
| export/useExportDialogActions.ts、export/useExportRunner.ts、export/exportRunnerSupport.ts、export/useEditorExportController.ts | 导出前置检查、保存取消、导出失败、显示文件夹 | 直接写导出英文 toast | 接入 editor.exportStatus.*，并把翻译函数沿控制器传入导出 hooks |
| project/useProjectSaveActions.ts、project/useProjectOpenActions.ts、project/useEditorProjectController.ts | 项目保存/加载/导入反馈 | Project saved...、Failed to load project 等英文 toast | 接入 editor.project.*，并把“打开其他项目/导入文件”作为可翻译动作名 |
| src/hooks/useScreenRecorder.ts | 未选择录制源时的系统提示 | alert("Please select a source to record") | alert(t("launch.permissions.selectSource", ...)) |

## 3. 验证

新增测试文件 src/i18n/i18nLocale.test.ts，覆盖本次关键中文键和占位符。

已运行并通过：

- npx vitest --run src/i18n/i18nLocale.test.ts
- npm run i18n:check
- npx tsc --noEmit
- npm run lint
- npm test：141 个测试文件通过，1210 个测试通过，1 个原有测试跳过
- git diff --check

## 4. 手动调整名称的方法

### 4.1 调整界面固定文案

直接编辑对应语言文件，例如：

~~~text
src/i18n/locales/zh-CN/settings.json
~~~

代码中的 tSettings("effects.auto", "Auto") 对应 JSON 中的：

~~~text
settings.json -> effects -> auto
~~~

代码中的 t("editor.project.savedTo", "Project saved to {{path}}", ...) 对应：

~~~text
editor.json -> project -> savedTo
~~~

保存 JSON 后运行 npm run i18n:check，可检查所有语言文件的键结构是否一致。

### 4.2 调整带变量的文案

占位符名称必须保持不变，只修改占位符周围的文字。例如：

~~~text
已成功导出到 {{path}}
项目已保存到 {{path}}
导出失败：{{error}}
~~~

不要把 {{path}} 改成别的名字，否则运行时不会替换实际路径。

### 4.3 调整系统音频/麦克风/字体/项目名称

这类名称不是翻译资源，而是运行时从系统或用户数据读取的动态值：

- 系统音频设备的格式化位置是 src/hooks/audioOutputDevices.ts，其中 normalizeBrowserAudioOutputLabel 负责识别并保留 USB 标识，enrichNativeAudioOutputLabels 负责把原生设备名与浏览器枚举名称合并。
- 因此 Default - 扬声器 (Yeti Nano) (046d:0acf) 这类名称不应写进 zh-CN/*.json。若要改变格式，应修改上述函数；若只想改设备显示名，优先在 Windows 声音设置中修改设备名称。
- 自定义字体名、项目名来自用户选择或项目文件，也不在翻译 JSON 中；需要在字体/项目数据源或生成显示名的代码处修改。

修改动态名称后，重新启动开发版并重新打开对应菜单即可看到结果。

本次修改已整理为独立的中文本地化提交，没有删除或覆盖项目中的二进制/构建产物。
