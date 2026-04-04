
from IgnoreVariable import *
from dir import * # USING_PWS_INCLUDE
from userCheck import * # USING_PWS_INCLUDE
set_priority(2)

def is_subdir(path, directory):
    path = os.path.realpath(path)
    directory = os.path.realpath(directory)

    relative = os.path.relpath(path, directory)

    if relative.startswith(os.pardir):
        return False
    else:
        return True

if not checkCookie():
    print("You are not allowed to download file before you login.")

else:
    downloadfile = (_GET.get("filepath", None))
    TIMESLEEP    = 0.02

    import Logger
    Logger = Logger.Logger()


    def getRange(xd):
        if '=' in xd and xd.split("=")[0] == 'bytes':
            return getRange(xd.split("=")[1])
        if '-' in xd:
            x = xd.split("-")
            if x[1] == '':
                f1 = ''
            else:
                f1 = int(x[1])
            f = int(x[0])
            return [f,f1]
        else:
            try:
                int(xd)
            except:
                return [0,0]
            else:
                return int(xd), int(xd)

    import os, time
    
    filepath = ""
    Continue = True
    if _GET.get("user", None):
        Continue = False
        if not getUserPermission(username) == "admin":
            print("You dont have permission to download this file.")
        else:
            filepath = netdisk_rootdir + _GET.get("user") + "/" + downloadfile
            Continue = True

    if downloadfile and Continue:
        if not filepath:
            filepath = netdisk_rootdir + username + "/" + downloadfile

        if ".." in filepath:
            print("You cant use '..' in path.")
        elif not is_subdir(filepath, netdisk_rootdir) and not getUserPermission(username) == "admin":
            print("You cant download other file out of user space.")
        else:

            if os.path.isfile(filepath):
                
                filename = os.path.split(filepath)[1]

                set_header("Content-disposition", "attachment; filename=%s" % os.path.split(filepath)[1])
                set_header("Content-type", "application/octet-stream")
                set_header("Content-length", str(os.path.getsize(filepath)))

                with open(filepath, 'rb') as f:
                    if _HEADER.get("range"):
                        r = getRange(_HEADER.get("range"))
                        tsize = os.path.getsize(filepath)
                        size = (r[1] + 1 if not r[1] == '' else tsize) - r[0]
                        set_header("Content-Range", "bytes %s-%s/%s"%(r[0], r[1] if not r[1] == '' else tsize-1, tsize))
                        set_header(0, "HTTP/1.1 206 Partial Content")

                        f.seek(r[0])

                        readTotalLength = (r[1] + 1 if not r[1] == '' else tsize) - r[0]
                        readPartTimes   = (readTotalLength // (1024*1024)) if 1024*1024 < readTotalLength else 1
                        endReadLength   = (readTotalLength - readPartTimes * 1024*1024) if 1024*1024 < readTotalLength else 0

                        if 1024*1024 > readTotalLength:
                            readSize = readTotalLength
                        else:
                            readSize = 1024*1024

                        set_header("Content-length", readTotalLength)
                        finish_header()

                        for i in range(readPartTimes + 1):
                            if i == readPartTimes:
                                print(f.read(endReadLength))
                            else:
                                print(f.read(readSize))
                            time.sleep(TIMESLEEP)

                    else:
                        finish_header()
                        read = f.read(1024*1024)
                        while 1:
                            if read == b'':
                                break
                            print(read)
                            read = f.read(1024*1024)
                            time.sleep(TIMESLEEP)    #如果不写time.sleep你的服务器会死得很惨的（亲身经历）
                                                    #同时操控time.sleep的参数以及一次read的大小可以控制下载速度

            else:
                set_header(0, 'HTTP/1.1 404 FileNotFound')
                print("File not found: %s %s" % (downloadfile, str(_GET)))
