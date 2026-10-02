!include "${BUILD_RESOURCES_DIR}\chrome-store.nsh"
!macro customInstall
  ; Remove the old per-user registrations which otherwise shadow the new machine keys.
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.dubbitig.capture"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\DubBitig"
  DeleteRegKey HKCU "Software\Classes\DesktopBackground\Shell\DubBitig"
  DeleteRegKey HKCU "Software\Classes\*\shell\DubBitig"
  !ifdef DUBBITIG_CHROME_STORE_ID
    SetRegView 32
    WriteRegStr HKLM "Software\Google\Chrome\Extensions\${DUBBITIG_CHROME_STORE_ID}" "update_url" "https://clients2.google.com/service/update2/crx"
    SetRegView lastused
  !endif
  WriteRegStr SHCTX "Software\Google\Chrome\NativeMessagingHosts\com.dubbitig.capture" "" "$INSTDIR\resources\native-host\com.dubbitig.capture.json"
  WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\DubBitig" "" "Panodakini DubBitig'e kaydet"
  WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\DubBitig" "Icon" "$INSTDIR\DubBitig.exe,0"
  WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\DubBitig\command" "" '$\"$INSTDIR\DubBitig.exe$\" --capture-clipboard'
  WriteRegStr SHCTX "Software\Classes\DesktopBackground\Shell\DubBitig" "" "Panodakini DubBitig'e kaydet"
  WriteRegStr SHCTX "Software\Classes\DesktopBackground\Shell\DubBitig" "Icon" "$INSTDIR\DubBitig.exe,0"
  WriteRegStr SHCTX "Software\Classes\DesktopBackground\Shell\DubBitig\command" "" '$\"$INSTDIR\DubBitig.exe$\" --capture-clipboard'
  WriteRegStr SHCTX "Software\Classes\*\shell\DubBitig" "" "DubBitig'e kaydet"
  WriteRegStr SHCTX "Software\Classes\*\shell\DubBitig" "Icon" "$INSTDIR\DubBitig.exe,0"
  WriteRegStr SHCTX "Software\Classes\*\shell\DubBitig\command" "" '$\"$INSTDIR\DubBitig.exe$\" $\"--capture-file=%1$\"'
  CreateShortCut "$SMPROGRAMS\DubBitig Chrome eklentisi.lnk" "$INSTDIR\resources\chrome-extension"
!macroend

!macro customUnInstall
  !ifdef DUBBITIG_CHROME_STORE_ID
    SetRegView 32
    DeleteRegKey HKLM "Software\Google\Chrome\Extensions\${DUBBITIG_CHROME_STORE_ID}"
    SetRegView lastused
  !endif
  DeleteRegKey SHCTX "Software\Google\Chrome\NativeMessagingHosts\com.dubbitig.capture"
  DeleteRegKey SHCTX "Software\Classes\Directory\Background\shell\DubBitig"
  DeleteRegKey SHCTX "Software\Classes\DesktopBackground\Shell\DubBitig"
  DeleteRegKey SHCTX "Software\Classes\*\shell\DubBitig"
  Delete "$SMPROGRAMS\DubBitig Chrome eklentisi.lnk"
  ; User archives and backups deliberately remain under APPDATA\DubBitig.
!macroend
