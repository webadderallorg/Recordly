import { useState, useEffect } from "react";
import { Button } from "../ui/button";
import { MdCheck } from "react-icons/md";
import { Monitor, Video, AppWindow } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Card } from "../ui/card";
import { useScopedT } from "../../contexts/I18nContext";
import styles from "./SourceSelector.module.css";

interface DesktopSource {
  id: string;
  name: string;
  thumbnail: string | null;
  display_id: string;
  appIcon: string | null;
  originalName: string;
  sourceType: 'screen' | 'window';
  appName?: string;
  windowTitle?: string;
}

function parseSourceMetadata(source: any) {
  if (source.sourceType === 'window' && (source.appName || source.windowTitle)) {
    return {
      sourceType: 'window' as const,
      appName: source.appName,
      windowTitle: source.windowTitle ?? source.name,
      displayName: source.windowTitle ?? source.name,
    };
  }

  const sourceType: 'screen' | 'window' = source.id.startsWith('window:') ? 'window' : 'screen';
  if (sourceType === 'window') {
    const [appNamePart, ...windowTitleParts] = source.name.split(' — ');
    const appName = appNamePart?.trim() || undefined;
    const windowTitle = windowTitleParts.join(' — ').trim() || source.name.trim();

    return {
      sourceType,
      appName,
      windowTitle,
      displayName: windowTitle,
    };
  }

  return {
    sourceType,
    appName: undefined,
    windowTitle: undefined,
    displayName: source.name,
  };
}

export function SourceSelector() {
  const t = useScopedT('launch');
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<DesktopSource | null>(null);
  const [activeTab, setActiveTab] = useState<'screens' | 'windows'>('screens');
  const [recordingMode, setRecordingMode] = useState<'full' | 'area'>('full');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSources() {
      setLoading(true);
      try {
        const rawSources = await window.electronAPI.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 320, height: 180 },
          fetchWindowIcons: true
        });
        setSources(
          rawSources.map(source => {
            const metadata = parseSourceMetadata(source);

            return {
              id: source.id,
              name: metadata.displayName,
              thumbnail: source.thumbnail,
              display_id: source.display_id,
              appIcon: source.appIcon,
              originalName: source.name,
              sourceType: metadata.sourceType,
              appName: metadata.appName,
              windowTitle: metadata.windowTitle,
            };
          })
        );
      } catch (error) {
        console.error('Error loading sources:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchSources();
  }, []);

  const screenSources = sources.filter(s => s.id.startsWith('screen:'));
  const windowSources = sources.filter(s => s.id.startsWith('window:'));

  useEffect(() => {
    if (loading) {
      return;
    }

    if (screenSources.length === 0 && windowSources.length > 0) {
      setActiveTab('windows');
      return;
    }

    if (windowSources.length === 0 && screenSources.length > 0) {
      setActiveTab('screens');
    }
  }, [loading, screenSources.length, windowSources.length]);

  const handleSourceSelect = (source: DesktopSource) => {
    setSelectedSource(source);
    // Reset to full screen mode when changing sources
    setRecordingMode('full');
  };

  const handleShare = async () => {
    if (!selectedSource) return;

    if (selectedSource.id.startsWith('screen:') && recordingMode === 'area') {
      // If area mode is selected for a screen, open the selector for that display
      await window.electronAPI.openAreaSelector({ displayId: selectedSource.display_id });
      // The selector will handle closing this window once confirmed
      return;
    }

    await window.electronAPI.selectSource(selectedSource);
  };

  if (loading) {
    return (
      <div className={`h-full flex items-center justify-center ${styles.glassContainer}`} style={{ minHeight: '100vh' }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-zinc-600 mx-auto mb-2" />
          <p className="text-xs text-zinc-300">{t('sourceSelector.loadingSources')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-full flex flex-col items-center bg-zinc-950 select-none overflow-hidden ${styles.glassContainer}`}>
      <div className="flex-1 flex flex-col w-full max-w-xl overflow-hidden p-5 pb-0">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'screens' | 'windows')} className="flex flex-col h-full overflow-hidden">
          <TabsList className="grid grid-cols-2 mb-3 bg-zinc-900/40 rounded-full shrink-0">
            <TabsTrigger value="screens" className="data-[state=active]:bg-[#2563EB] data-[state=active]:text-white text-zinc-200 rounded-full text-xs py-1">
              {t('sourceSelector.screens')} ({screenSources.length})
            </TabsTrigger>
            <TabsTrigger value="windows" className="data-[state=active]:bg-[#2563EB] data-[state=active]:text-white text-zinc-200 rounded-full text-xs py-1">
              {t('sourceSelector.windows')} ({windowSources.length})
            </TabsTrigger>
          </TabsList>
          
          <div className="h-56 flex flex-col justify-stretch overflow-hidden">
            <TabsContent value="screens" className="h-full mt-0">
              <div className={`grid grid-cols-2 gap-2 h-full overflow-y-auto pr-1 relative ${styles.sourceGridScroll}`}>
                {screenSources.length === 0 && (
                  <div className="col-span-2 text-center text-xs text-zinc-500 py-8">No screens available</div>
                )}
                {screenSources.map(source => (
                  <Card
                    key={source.id}
                    className={`${styles.sourceCard} ${selectedSource?.id === source.id ? styles.selected : ''} cursor-pointer h-fit p-2 scale-95 transition-all`}
                    style={{ margin: 4, width: '90%', maxWidth: 220 }}
                    onClick={() => handleSourceSelect(source)}
                  >
                    <div className="p-1">
                      <div className="relative mb-1">
                        <img
                          src={source.thumbnail || ''}
                          alt={source.name}
                          className="w-full aspect-video object-cover rounded border border-zinc-800"
                        />
                        {selectedSource?.id === source.id && (
                          <div className="absolute -top-1 -right-1">
                            <div className="w-4 h-4 bg-[#2563EB] rounded-full flex items-center justify-center shadow-md">
                              <MdCheck className={styles.icon} />
                            </div>
                          </div>
                        )}
                      </div>
                      <div className={styles.name + " truncate"}>
                        {source.name} — <span className="text-[#2563EB] font-bold">
                          {selectedSource?.id === source.id ? (recordingMode === 'full' ? 'FULL' : 'AREA') : 'FULL'}
                        </span>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </TabsContent>
            
            <TabsContent value="windows" className="h-full mt-0">
              <p className="text-[10px] text-zinc-500 mb-1 px-1 shrink-0">{t('sourceSelector.windowsNote')}</p>
              <div className={`grid grid-cols-2 gap-2 h-full overflow-y-auto pr-1 relative ${styles.sourceGridScroll}`}>
                {windowSources.length === 0 && (
                  <div className="col-span-2 text-center text-xs text-zinc-500 py-8">No windows available</div>
                )}
                {windowSources.map(source => (
                  <Card
                    key={source.id}
                    className={`${styles.sourceCard} ${selectedSource?.id === source.id ? styles.selected : ''} cursor-pointer h-fit p-2 scale-95 transition-all`}
                    style={{ margin: 4, width: '90%', maxWidth: 220 }}
                    onClick={() => handleSourceSelect(source)}
                  >
                    <div className="p-1">
                      <div className="relative mb-1">
                        {source.thumbnail ? (
                          <img
                            src={source.thumbnail}
                            alt={source.name}
                            className="w-full aspect-video object-cover rounded border border-gray-700"
                          />
                        ) : (
                          <div className="w-full aspect-video rounded border border-gray-700 bg-zinc-900/80 flex flex-col items-center justify-center text-zinc-400 gap-2">
                            {source.appIcon ? (
                              <img src={source.appIcon} alt="App icon" className="w-8 h-8 rounded-md" />
                            ) : (
                              <AppWindow size={24} />
                            )}
                            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{t('sourceSelector.windowPlaceholder')}</div>
                          </div>
                        )}
                        {selectedSource?.id === source.id && (
                          <div className="absolute -top-1 -right-1">
                            <div className="w-4 h-4 bg-blue-600 rounded-full flex items-center justify-center shadow-md">
                              <MdCheck className={styles.icon} />
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {source.appIcon && (
                          <img src={source.appIcon} alt="App icon" className={styles.icon + " flex-shrink-0"} />
                        )}
                        <div className={styles.name + " truncate"}>{source.name}</div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>

      <div className="border-t border-zinc-900 p-6 w-full bg-[#08080a] shrink-0">
        <div className="flex flex-col gap-4 max-w-lg mx-auto">
          {selectedSource ? (
            <div className={`flex flex-col gap-3 transition-all duration-300 ${selectedSource.sourceType === 'window' ? 'opacity-40 grayscale pointer-events-none' : 'opacity-100'}`}>
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] uppercase tracking-[0.25em] text-blue-500/80 font-black">Recording Configuration</span>
              </div>
              <div className="flex items-center gap-4 p-2 bg-zinc-950/80 rounded-xl border border-zinc-800/80 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
                <button
                  onClick={() => setRecordingMode('full')}
                  className={`flex-1 px-4 py-3 text-[11px] font-black rounded-lg transition-all flex flex-col items-center justify-center gap-1.5 ${
                    recordingMode === 'full' 
                    ? 'bg-[#2563EB] text-white shadow-[0_8px_20px_rgba(37,99,235,0.4)] scale-[1.02]' 
                    : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900'
                  }`}
                >
                  <Monitor size={18} strokeWidth={3} />
                  {t('sourceSelector.fullScreen', 'Full Screen').toUpperCase()}
                </button>
                <button
                  onClick={() => setRecordingMode('area')}
                  className={`flex-1 px-4 py-3 text-[11px] font-black rounded-lg transition-all flex flex-col items-center justify-center gap-1.5 ${
                    recordingMode === 'area' 
                    ? 'bg-[#2563EB] text-white shadow-[0_8px_20px_rgba(37,99,235,0.4)] scale-[1.02]' 
                    : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900'
                  }`}
                >
                  <Video size={18} strokeWidth={3} />
                  {t('sourceSelector.selectArea', 'Select Area').toUpperCase()}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 border border-zinc-900 rounded-xl bg-zinc-950/40">
              <span className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold">Select a monitor to configure</span>
            </div>
          )}
          
          <div className="flex justify-center gap-2">
            <Button 
              variant="outline" 
              onClick={() => window.close()} 
              className="flex-1 py-1.5 text-xs bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            >
              {t('sourceSelector.cancel')}
            </Button>
            
            <Button 
              onClick={handleShare} 
              disabled={!selectedSource} 
              className="flex-[2] py-1.5 text-xs bg-[#2563EB] text-white hover:bg-blue-600 shadow-lg shadow-blue-500/30 disabled:opacity-50 transition-all font-bold uppercase tracking-wider"
            >
              {recordingMode === 'area' ? t('sourceSelector.next', 'Next') : t('sourceSelector.share')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
