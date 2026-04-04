
import os
from userCheck import * # USING_PWS_INCLUDE
from IgnoreVariable import *
from dir import * # USING_PWS_INCLUDE

set_priority(0.1)


def is_subdir(path, directory):
    path = os.path.realpath(path)
    directory = os.path.realpath(directory)
    relative  = os.path.relpath(path, directory)
    
    if relative.startswith(os.pardir):
        return False
    else:
        return True

if not len(_FILE) == 0:
    if not checkCookie():
        print("You are not allowed to upload file before you login.")

    else:
        dstPath     = (_GET.get("path", "/"))
        trueDstPath = netdisk_rootdir + username + "/" + dstPath

        dstUser = _GET.get("username", "")
        dstUserDir = ""

        if dstUser and getUserPermission(username) == 'admin':
            trueDstPath = netdisk_rootdir + dstUser + "/" + dstPath
            dstUserDir  = netdisk_rootdir + dstUser + "/"

        if ".." in dstPath or '..' in dstUser:
            print("CANNOT USE .. in PATH or USERNAME!!!")

        elif not dstUserDir == "" and  not is_subdir(trueDstPath, dstUserDir):
            print("Cannot put file in other filedir!!!", trueDstPath)

        elif _FILE["file"].getName():
            _FILE["file"].getFile().move(f"{trueDstPath}/{_FILE['file'].getName()}")
            print(_FILE)

        else:
            print("No named.")
