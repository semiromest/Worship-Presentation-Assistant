; Default icon for the extension. Modern Explorer UserChoice associations can
; override this fallback; it does NOT guarantee an app-independent icon.
; Never alter Explorer's UserChoice registration.
!macro customInstall
  ; Quote executable and document separately; install paths contain spaces.
  WriteRegStr SHELL_CONTEXT "Software\Classes\WorshipPresentationAssistant.Project\shell\open\command" "" '"$appExe" "%1"'
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\WorshipPresentationAssistant.Project" "PreviousExtensionIconState"
  ${If} $0 == ""
    ClearErrors
    ReadRegStr $1 SHELL_CONTEXT "Software\Classes\.gpres\DefaultIcon" ""
    ${If} ${Errors}
      WriteRegStr SHELL_CONTEXT "Software\Classes\WorshipPresentationAssistant.Project" "PreviousExtensionIconState" "absent"
    ${Else}
      WriteRegStr SHELL_CONTEXT "Software\Classes\WorshipPresentationAssistant.Project" "PreviousExtensionIconState" "present"
      WriteRegStr SHELL_CONTEXT "Software\Classes\WorshipPresentationAssistant.Project" "PreviousExtensionIcon" "$1"
    ${EndIf}
  ${EndIf}
  WriteRegStr SHELL_CONTEXT "Software\Classes\.gpres\DefaultIcon" "" "$INSTDIR\resources\gpres.ico"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.gpres\DefaultIcon" ""
  ${If} $0 == "$INSTDIR\resources\gpres.ico"
    ReadRegStr $1 SHELL_CONTEXT "Software\Classes\WorshipPresentationAssistant.Project" "PreviousExtensionIconState"
    ${If} $1 == "present"
      ReadRegStr $2 SHELL_CONTEXT "Software\Classes\WorshipPresentationAssistant.Project" "PreviousExtensionIcon"
      WriteRegStr SHELL_CONTEXT "Software\Classes\.gpres\DefaultIcon" "" "$2"
    ${Else}
      DeleteRegValue SHELL_CONTEXT "Software\Classes\.gpres\DefaultIcon" ""
      DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.gpres\DefaultIcon"
    ${EndIf}
  ${EndIf}
  DeleteRegValue SHELL_CONTEXT "Software\Classes\WorshipPresentationAssistant.Project" "PreviousExtensionIcon"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\WorshipPresentationAssistant.Project" "PreviousExtensionIconState"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
