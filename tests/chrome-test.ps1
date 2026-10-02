$ErrorActionPreference = 'Stop'
$manifest = (Resolve-Path -LiteralPath 'release-dubbitig\win-unpacked\resources\native-host\com.dubbitig.capture.json').Path
$testKeys = @('Software\Google\Chrome\NativeMessagingHosts\com.dubbitig.capture','Software\Google\ChromeForTesting\NativeMessagingHosts\com.dubbitig.capture')
$createdKeys = @()
try {
  foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)) {
    $root = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$view)
    try {
      foreach ($keyPath in $testKeys) {
        $existing = $root.OpenSubKey($keyPath)
        if ($null -ne $existing) { $value=$existing.GetValue('');$existing.Dispose();if(Test-Path -LiteralPath $value){Write-Output "Using existing host registration: $value";continue};throw "Existing registration is invalid: $keyPath" }
        $key = $root.CreateSubKey($keyPath); $key.SetValue('',$manifest); $key.Dispose()
        $createdKeys += ,@($view,$keyPath)
      }
    } finally { $root.Dispose() }
  }
  node tests/chrome-extension.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Chrome bağlantı testi başarısız.' }
} finally {
  foreach ($pair in $createdKeys) {
    $root = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$pair[0])
    try { $root.DeleteSubKeyTree($pair[1],$false) } finally { $root.Dispose() }
  }
}
