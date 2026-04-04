from IgnoreVariable import *
from dir import * # USING_PWS_INCLUDE
from userCheck import * # USING_PWS_INCLUDE
from urllib.parse import unquote
set_priority(2)
downloadfile = unquote(_GET.get("filepath", None)) if _GET.get("filepath", False) else ""

if not checkCookie():
    print('{"error":"no permissions"}')
else:

    TIMESLEEP = 0.0001
    CACHESIZE = 10240


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

    import os
    from FileTypes import return_filetype
    def FileType(path):
        for i in return_filetype:
            v = return_filetype[i]
            if i == 'default':
                continue
            for i2 in v:
                if path[-len(i2)-1:].lower() == '.'+i2:
                    return i.replace('.', '/', 1)
        return return_filetype['default'].replace('.', '/')

    if downloadfile:
        filepath = netdisk_rootdir + username + "/" + downloadfile
        if os.path.isfile(filepath):
            
            filename = os.path.split(filepath)[1]

            set_header("content-type", FileType(filename))
            set_header("content-length", str(os.path.getsize(filepath)))
            set_header("content-disposition", f"inline; filename=\"{filename}\"")

            with open(filepath, 'rb') as f:
                if _HEADER.get("range"):
                    r = getRange(_HEADER.get("range"))
                    tsize = os.path.getsize(filepath)
                    size = (r[1] + 1 if not r[1] == '' else tsize) - r[0]
                    set_header("content-range", "bytes %s-%s/%s"%(r[0], r[1] if not r[1] == '' else tsize-1, tsize))
                    set_header(0, "HTTP/1.1 206 Partial Content")

                    f.seek(r[0])

                    readTotalLength = (r[1] + 1 if not r[1] == '' else tsize) - r[0]
                    readPartTimes   = (readTotalLength // (CACHESIZE)) if CACHESIZE < readTotalLength else 1
                    endReadLength   = (readTotalLength - readPartTimes * CACHESIZE) if CACHESIZE < readTotalLength else 0

                    if CACHESIZE > readTotalLength:
                        readSize = readTotalLength
                    else:
                        readSize = CACHESIZE

                    set_header("content-length", readTotalLength)
                    finish_header()

                    for i in range(readPartTimes + 1):
                        if i == readPartTimes:
                            print(f.read(endReadLength))
                        else:
                            print(f.read(readSize))

                else:
                    set_header("content-length", str(os.path.getsize(filepath)))
                    set_header("content-type",   FileType(filepath))
                    finish_header()
                    
                    read = f.read(CACHESIZE)
                    while 1:
                        if read == b'':
                            break
                        print(read)
                        read = f.read(CACHESIZE)
        else:
            print('{"error":"file not found: %s"}' % filepath)
