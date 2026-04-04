import os
import shutil
from IgnoreVariable import *
from dir import * # USING_PWS_INCLUDE
from userCheck import * # USING_PWS_INCLUDE
set_priority(0.1)
def is_subdir(path, directory):
    path = os.path.realpath(path)
    directory = os.path.realpath(directory)

    relative = os.path.relpath(path, directory)

    if relative.startswith(os.pardir):
        return False
    else:
        return True

if not checkCookie():
    print('{"error":"no permissions"}')
else:

    src_path  = (_GET.get("src", "")).strip()
    dest_path = (_GET.get("dest", "")).strip()
    is_cut    = _GET.get("cut", "false").lower() == "true"

    trueSrcPath = netdisk_rootdir + username + "/" + src_path
    trueDstPath = netdisk_rootdir + username + "/" + dest_path

    if ".." in src_path or ".." in dest_path:
        print('{"error":"CANNOT USE .. in PATH!"}')

    elif not is_subdir(trueSrcPath, netdisk_rootdir+username) or \
         not is_subdir(trueDstPath, netdisk_rootdir+username):
        print('{"error":"Cannot put file in other filedir!!!"}')
        
    elif os.path.exists(trueSrcPath):
        try:
            if is_cut:
                # Move file
                shutil.move(trueSrcPath, trueDstPath)
                print('{"success":"Moved file: '+src_path+' to '+dest_path+'"}')
            else:
                # Copy file
                if os.path.isfile(trueSrcPath):
                    shutil.copy2(trueSrcPath, trueDstPath)
                else:
                    shutil.copytree(trueSrcPath, trueDstPath)
                print(f"Copied file from {src_path} to {dest_path}")
        except Exception as e:
            print(f"Error moving/copying file: {str(e)}")
    else:
        print('{"error":"File does not exist: '+src_path+'"}')
