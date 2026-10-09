!define AGENTMETER_SHORTCUT_NAME "AgentMeter"

; Tauri's finish-page action remains the only creator of the desktop shortcut;
; existing profile/preferences files stay put.
!macro NSIS_HOOK_PREUNINSTALL
  ; Update mode preserves the current AgentMeter shortcuts.
  ${If} $UpdateMode <> 1
    Delete "$DESKTOP\${AGENTMETER_SHORTCUT_NAME}.lnk"
    Delete "$SMPROGRAMS\${AGENTMETER_SHORTCUT_NAME}.lnk"
  ${EndIf}
!macroend
