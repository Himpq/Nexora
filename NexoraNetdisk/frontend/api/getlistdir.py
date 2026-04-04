from IgnoreVariable import *
from dir import * # USING_PWS_INCLUDE
from userCheck import * # USING_PWS_INCLUDE
set_priority(0.1)

#_COOKIE.get("wnuid") == None or (not _COOKIE.get("wnuid") == None and not checkUserBySha2(*(_COOKIE.get("wnuid").split(","))))
if not checkCookie():
    print("{'error': 'login'}".replace("'", '"'))

else:
    user_rootdir = ""
    if getUserPermission(username) == "admin":
        if _GET.get("user", None):
            dstUser = _GET.get("user")
            user_rootdir = netdisk_rootdir + dstUser + "/"
            request_dir  = user_rootdir + _GET.get("dir", '')


    if not user_rootdir:
        user_rootdir = netdisk_rootdir + username + "/"
        request_dir  = user_rootdir + _GET.get("dir", '')

        if not os.path.isdir(user_rootdir):
            os.mkdir(user_rootdir)
            

    if ".." in request_dir:
        print('{"error":"cannot use \'..\' in WNetdisk!"')
    else:
        import json, os
        

        if _GET.get("dir", None):
            if os.path.isdir(request_dir):
                details = sorted(os.listdir(request_dir), key=lambda i:not os.path.isdir(request_dir+"/"+i))
                d = {}
                for i in range(len(details)):
                    d[i] = {
                        "request_user": username,
                        "name":         details[i],
                        "type":         os.path.isfile(request_dir+"/"+details[i])
                    }
                print(json.dumps(d))
            else:
                print("{'error':'not a dir'}".replace("'", '"'))
        else:
            print("{'error':'cannot find dir'}".replace("'", '"'))
