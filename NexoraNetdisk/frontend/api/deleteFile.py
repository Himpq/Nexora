import os
from userCheck import * # USING_PWS_INCLUDE
from IgnoreVariable import *
import shutil
from dir import * # USING_PWS_INCLUDE
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
    print("You are not allowed to delete file before you login.")

else:
    dstPath = _GET.get("path", "/")
    trueDstPath = netdisk_rootdir + username + "/" + dstPath

    if ".." in trueDstPath:
        print("CANNOT USE .. in PATH!")

    elif not is_subdir(trueDstPath, netdisk_rootdir+username):
        print("Cannot delete file out of root filedir!!!", trueDstPath)
    elif os.path.isfile(trueDstPath):
        # os.remove(dir_+PATH)
        os.replace(trueDstPath, trashbin_dir+os.path.basename(trueDstPath))
        print("removed:",trueDstPath)
    elif os.path.isdir(trueDstPath):
        # os.rmdir(dir_+PATH)
        
        base_name = os.path.basename(trueDstPath)
        target_base = trashbin_dir + username + "/" + base_name
        
        if not os.path.isdir(trashbin_dir + username):
            os.mkdir(trashbin_dir + username)

        counter = 1
        while os.path.isdir(target_base):
            target_base = f"{trashbin_dir}{base_name}_{counter}"
            counter += 1
        shutil.move(trueDstPath, target_base)
        print("removed:",trueDstPath)

    else:
        print("provide argument.")
