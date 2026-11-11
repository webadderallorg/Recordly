!macro customInit
  DetailPrint "Ensuring existing Recordly processes are terminated..."
  nsExec::Exec 'taskkill /F /IM Recordly.exe /T'
  nsExec::Exec 'taskkill /F /IM recordly-gpu-export.exe /T'
  nsExec::Exec 'taskkill /F /IM cursor-monitor.exe /T'
  nsExec::Exec 'taskkill /F /IM wgc-capture.exe /T'
  nsExec::Exec 'taskkill /F /IM whisper-cli.exe /T'
  nsExec::Exec 'taskkill /F /IM ffmpeg.exe /T'
  Sleep 1000
!macroend

!macro customUnInit
  DetailPrint "Ensuring existing Recordly processes are terminated before uninstall..."
  nsExec::Exec 'taskkill /F /IM Recordly.exe /T'
  nsExec::Exec 'taskkill /F /IM recordly-gpu-export.exe /T'
  nsExec::Exec 'taskkill /F /IM cursor-monitor.exe /T'
  nsExec::Exec 'taskkill /F /IM wgc-capture.exe /T'
  nsExec::Exec 'taskkill /F /IM whisper-cli.exe /T'
  nsExec::Exec 'taskkill /F /IM ffmpeg.exe /T'
  Sleep 1000
!macroend
