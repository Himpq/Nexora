
from IgnoreVariable import *
from dir import * # USING_PWS_INCLUDE
import json, os
from userCheck import * # USING_PWS_INCLUDE
set_priority(0.1)
if not checkCookie():
    print("{'error': 'login'}".replace("'", '"'))
else:

    file = netdisk_rootdir + username + "/" + _GET.get("filepath", '')

    if _GET.get("filepath", None):
        if os.path.isfile(file):
            details = {
                "filename": os.path.split(file)[1],
                "filesize": os.path.getsize(file),
                "filecreatedate": os.path.getctime(file)
            }
            print(json.dumps(details))
        else:
            print("{'error':'not a file'}".replace("'", '"'))
    else:
        print("{'error':'cannot find file'}".replace("'", '"'))
