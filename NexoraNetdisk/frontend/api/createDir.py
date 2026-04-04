import os
from userCheck import * # USING_PWS_INCLUDE
from IgnoreVariable import *
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
    print("You are not allowed to create dir before you login.")

else:
    dstPath = _GET.get("path", "/")
    trueDstPath = netdisk_rootdir + username + "/" + dstPath

    if ".." in trueDstPath:
        print("CANNOT USE .. in PATH!")

    elif dstPath == "/":
        print("Provie arguments!")

    elif not is_subdir(trueDstPath, netdisk_rootdir+username):
        print("Cannot create dir in root filedir!", trueDstPath)

    elif os.path.isdir(trueDstPath):
        print("Dir is already existed.")
    else:
        try:
            os.mkdir(trueDstPath)
            print("created:",trueDstPath)

        except Exception as e:
            print("Error:", e)
