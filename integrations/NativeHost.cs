using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Threading;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Runtime.InteropServices;
using System.ComponentModel;

// A small stdio bridge: no network listener, shell command evaluation or browser profile edits.
class NativeHost {
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct StartupInfo {
    public int cb;public string reserved;public string desktop;public string title;
    public int x,y,xSize,ySize,xCountChars,yCountChars,fillAttribute,flags;
    public short showWindow,reserved2;public IntPtr reservedPointer,stdInput,stdOutput,stdError;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {public IntPtr process,thread;public int processId,threadId;}
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  static extern bool CreateProcess(string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inheritHandles,uint flags,IntPtr environment,string directory,ref StartupInfo startup,out ProcessInfo info);
  [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
  static int Launch(string exe) {
    var startup=new StartupInfo();startup.cb=Marshal.SizeOf(startup);ProcessInfo info;
    // The desktop process must never inherit Chrome's native-messaging pipes.
    if(!CreateProcess(exe,new StringBuilder("\""+exe+"\" --capture-inbox"),IntPtr.Zero,IntPtr.Zero,false,0,IntPtr.Zero,Path.GetDirectoryName(exe),ref startup,out info))throw new Win32Exception(Marshal.GetLastWin32Error());
    CloseHandle(info.process);CloseHandle(info.thread);return info.processId;
  }
  static JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 1048576 };
  static byte[] ReadExact(Stream input, int length) { var data=new byte[length];int offset=0;while(offset<length){int n=input.Read(data,offset,length-offset);if(n==0)throw new Exception("Eksik mesaj.");offset+=n;}return data; }
  static void Reply(object value) { var data=Encoding.UTF8.GetBytes(Json.Serialize(value));var output=Console.OpenStandardOutput();var header=BitConverter.GetBytes(data.Length);output.Write(header,0,4);output.Write(data,0,data.Length);output.Flush(); }
  static int Main(string[] args) {
    try {
      var home=AppDomain.CurrentDomain.BaseDirectory;
      var manifest=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(home,"com.dubbitig.capture.json")));
      var origins=(System.Collections.IEnumerable)manifest["allowed_origins"];bool allowed=false;
      foreach(var origin in origins)if(args.Length>0 && String.Equals(args[0],origin.ToString(),StringComparison.Ordinal))allowed=true;
      if(!allowed)throw new Exception("Bu eklentinin erişim izni yok.");
      var input=Console.OpenStandardInput();var length=BitConverter.ToInt32(ReadExact(input,4),0);
      if(length<2 || length>1048576)throw new Exception("Mesaj en fazla 1 MB olabilir.");
      var raw=Encoding.UTF8.GetString(ReadExact(input,length));var request=Json.Deserialize<Dictionary<string,object>>(raw);
      Guid uuid;if(!request.ContainsKey("id") || !Guid.TryParseExact(Convert.ToString(request["id"]),"D",out uuid))throw new Exception("Geçersiz istek kimliği.");
      if(!request.ContainsKey("type") || Convert.ToString(request["type"])!="save")throw new Exception("Geçersiz işlem.");
      var data=Environment.GetEnvironmentVariable("DUBBITIG_DATA_DIR") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),"DubBitig");
      var folder=Path.Combine(data,"capture-inbox");Directory.CreateDirectory(folder);
      var id=uuid.ToString("D");var file=Path.Combine(folder,id+".json");var receipt=Path.Combine(folder,id+".result");
      var exe=Environment.GetEnvironmentVariable("DUBBITIG_CAPTURE_EXE") ?? Path.GetFullPath(Path.Combine(home,"..","..","DubBitig.exe"));
      if(!File.Exists(exe))throw new Exception("DubBitig bulunamadı. Setup ile yeniden kur.");
      if(!File.Exists(receipt) && !File.Exists(file)) {
        var temp=file+"."+Guid.NewGuid().ToString("N")+".tmp";
        try {File.WriteAllText(temp,raw,new UTF8Encoding(false));if(!File.Exists(file))File.Move(temp,file);}finally{if(File.Exists(temp))File.Delete(temp);}
      }
      int startedProcessId=Launch(exe);
      for(int i=0;i<450;i++) {
        if(File.Exists(receipt)) {var response=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(receipt));response["startedProcessId"]=startedProcessId;Reply(response);File.Delete(receipt);return 0;}
        Thread.Sleep(100);
      }
      Reply(new {ok=true,queued=true,id=id,title="Kayıt sıraya alındı. DubBitig açıldığında tamamlanacak."});return 0;
    } catch(Exception error) {Reply(new {ok=false,error=error.Message});return 1;}
  }
}
