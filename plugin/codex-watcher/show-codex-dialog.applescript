on run argv
  set dialogTitle to "Codex"
  set dialogSubtitle to ""
  set dialogMessage to "Codex：任务已完成"
  set closeButtonLabel to "关闭"

  if (count of argv) ≥ 1 then set dialogTitle to item 1 of argv
  if (count of argv) ≥ 2 then set dialogSubtitle to item 2 of argv
  if (count of argv) ≥ 3 then set dialogMessage to item 3 of argv
  if (count of argv) ≥ 4 then set closeButtonLabel to item 4 of argv

  set bodyText to dialogMessage
  if dialogSubtitle is not "" then
    set bodyText to dialogSubtitle & return & dialogMessage
  end if

  try
    display dialog bodyText with title dialogTitle buttons {closeButtonLabel} default button closeButtonLabel with icon note
  on error number -128
    return
  end try
end run
