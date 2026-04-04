
from IgnoreVariable import *
from dir import * # USING_PWS_INCLUDE
from userCheck import * # USING_PWS_INCLUDE
import os
set_disable_etag(True)
set_priority(1)
downloadfile = _GET.get("filepath", None)

def is_subdir(path, directory):
    path = os.path.realpath(path)
    directory = os.path.realpath(directory)
    relative  = os.path.relpath(path, directory)
    if relative.startswith(os.pardir):
        return False
    else:
        return True

if not checkCookie():
    print('{"error":"no permissions"}')
    
elif downloadfile and downloadfile[-3:] == 'mp3':
    realpath = netdisk_rootdir + username + "/" + downloadfile
    import os
    if is_subdir(os.path.abspath(realpath),netdisk_rootdir):
        if os.path.isfile(realpath):
            from mutagen import File
            from PIL import Image
            from io import BytesIO
            try:
                p = File(realpath)
                pic = p.tags['APIC:'].data
                img = Image.open(BytesIO(pic))
                sv = BytesIO()
                img.save(sv, format='JPEG', quality=1)
                sv.seek(0)
                pic = sv.read()
            except Exception as e:
                set_header("content-type", "plain/text")
                print('{"error":"%s"}'%str(e))
            else:
                import base64
                set_header("content-type", "image/jpg")

                print("data:image/jpg;base64,"+base64.b64encode(pic).decode("utf-8"))
    else:
        print('{"error": "no permissions"}', netdisk_rootdir, realpath)
else:
    print('{"error":"file not found."}')



    
