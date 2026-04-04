from IgnoreVariable import *
import os, hashlib
from dir import * # USING_PWS_INCLUDE "/www/wwwroot/pywebserver/Website/WNetdisk/api"
import json

def checkCookie():
    try:
        userCookie = _COOKIE.get("wnuid", None).split(",")
        un  = userCookie[0]
        pwd = userCookie[1]
    except:
        return False

    if userCookie:
        if checkUserBySha2(un, pwd):
            return True
        return False

def sha2(s):
    if not s:
        return None
    ret = hashlib.sha1(s.encode('utf-8'))
    return ret.hexdigest()

def checkUserBySha2(user, pwd):
    if os.path.isfile(user_dir+user+".json"):
        with open(user_dir+user+".json", "r") as f:
            data = json.load(f)
            if sha2(data["password"]) == pwd:
                return True
    return False

def checkUserByPwd(user, pwd):
    Logger.error(user_dir+user+".json")
    if os.path.isfile(user_dir+user+".json"):
        with open(user_dir+user+".json", "r") as f:
            data = json.load(f)
            if data["password"] == pwd:
                return True
    return False

def getUserPermission(user):
    if os.path.isfile(user_dir+user+".json"):
        with open(user_dir+user+".json", "r") as f:
            data = json.load(f)
            return data["role"]
    return "normal"

username = _COOKIE.get("wnuid").split(",")[0] if _COOKIE.get("wnuid") else None
