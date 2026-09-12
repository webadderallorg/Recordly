import OBSWebSocket from 'obs-websocket-js';

const obs = new OBSWebSocket();
let isObsModeEnabled = false;

export function setObsMode(enabled: boolean) {
    isObsModeEnabled = enabled;
}

export function getObsMode() {
    return isObsModeEnabled;
}

export async function connectObs(password?: string, url = 'ws://127.0.0.1:4455') {
    try {
        const { obsWebSocketVersion, negotiatedRpcVersion } = await obs.connect(url, password, {
            rpcVersion: 1
        });
        console.log(`Connected to OBS v${obsWebSocketVersion} (Using RPC v${negotiatedRpcVersion})`);
        return true;
    } catch (error) {
        console.error('Failed to connect to OBS', error);
        return false;
    }
}

export async function disconnectObs() {
    await obs.disconnect();
}

export async function disableCursorCapture() {
    try {
        const response = await obs.call('GetInputList');
        const inputs = response.inputs;
        
        for (const input of inputs) {
            // 'monitor_capture' (Windows display), 'window_capture' (Windows window)
            // 'coreaudio_output_capture' ... etc.
            // On mac it might be 'screen_capture' or 'window_capture' or 'mac_screencapture'
            if (String(input.inputKind).includes('capture')) {
                try {
                    await obs.call('SetInputSettings', {
                        inputName: input.inputName as string,
                        inputSettings: { capture_cursor: false, cursor: false }
                    });
                } catch (e) {
                    // Ignore if this specific input doesn't support capture_cursor
                }
            }
        }
        console.log('Disabled cursor capture for OBS inputs.');
    } catch (error) {
        console.error('Error disabling OBS cursor capture', error);
    }
}

export async function startObsRecording(): Promise<boolean> {
    try {
        // Auto configure
        await disableCursorCapture(); 
        
        return new Promise((resolve) => {
            const onRecordStateChanged = (data: any) => {
                if (data.outputActive && data.outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED') {
                    obs.off('RecordStateChanged', onRecordStateChanged);
                    resolve(true);
                } else if (!data.outputActive && data.outputState === 'OBS_WEBSOCKET_OUTPUT_START_FAILED') {
                    obs.off('RecordStateChanged', onRecordStateChanged);
                    resolve(false);
                }
            };
            
            obs.on('RecordStateChanged', onRecordStateChanged);
            
            obs.call('StartRecord').catch(error => {
                console.error('Failed to call StartRecord', error);
                obs.off('RecordStateChanged', onRecordStateChanged);
                resolve(false);
            });
            
            // Timeout after 5 seconds just in case
            setTimeout(() => {
                obs.off('RecordStateChanged', onRecordStateChanged);
                resolve(false);
            }, 5000);
        });
    } catch (error) {
        console.error('Failed to start OBS recording', error);
        return false;
    }
}

export async function stopObsRecording(): Promise<string | null> {
    try {
        const response = await obs.call('StopRecord');
        return response.outputPath;
    } catch (error) {
        console.error('Failed to stop OBS recording', error);
        return null;
    }
}
