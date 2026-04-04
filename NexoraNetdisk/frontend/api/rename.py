import os
from IgnoreVariable import *

from dir import * # USING_PWS_INCLUDE
from userCheck import * # USING_PWS_INCLUDE
set_priority(0.1)
set_header("Content-type", "text/plain; charset=utf-8")

def is_subdir(path, directory):
    path      = os.path.realpath(path)
    directory = os.path.realpath(directory)

    relative  = os.path.relpath(path, directory)

    if relative.startswith(os.pardir):
        return False
    else:
        return True

if not checkCookie():
    print('{"error":"no permissions"}')
else:
    oldPath = (_GET.get("old", "")).strip()
    newName = (_GET.get("new", "")).strip()
    
    trueOldPath = netdisk_rootdir + username + "/" + oldPath

    # Get the directory of old path and combine with new name
    parentDir   = os.path.dirname(oldPath)
    newPath     = os.path.join(parentDir, newName)
    trueNewPath = os.path.abspath(netdisk_rootdir + username + "/" + newPath)

    if ".." in oldPath or ".." in newPath:
        print('{"error":"CANNOT USE .. in PATH!"}')

    elif not is_subdir(trueOldPath, netdisk_rootdir+username) or \
         not is_subdir(trueNewPath, netdisk_rootdir+username):
        print('{"error":"Cannot rename file in other filedir!!!"}')
        
    elif not trueOldPath == "" and os.path.exists(trueOldPath) and not os.path.exists(trueNewPath) and not oldPath == "":
        try:
            os.rename(trueOldPath, trueNewPath)
            print('{"success":"Renamed file from '+oldPath+' to '+newPath+'"}')

        except Exception as e:
            print(f'{{"error":"Error renaming file: {str(e)}"}}')
    else:
        print('{"error":"File does not exist: '+oldPath+'"}')
