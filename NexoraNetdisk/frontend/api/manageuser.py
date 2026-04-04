from IgnoreVariable import *
import os, json
from dir import * # USING_PWS_INCLUDE
from userCheck import * # USING_PWS_INCLUDE
set_priority(0.1)
"""
<!--
API接口文档：
1. 获取用户列表: ./api/manageuser.py?type=alluser (GET)
2. 创建用户: ./api/manageuser.py?user={username}&pwd={password}&type=create (GET)
3. 修改密码: ./api/manageuser.py?user={username}&pwd={newpassword}&type=changepwd (GET)
4. 修改权限: ./api/manageuser.py?user={username}&role={role} (GET)
5. 获取目录: ./api/getlistdir.py?user={username}&dir={path} (GET)
6. 下载文件: ./api/download.py?user={username}&filepath={filepath} (GET)
-->
"""
def is_subdir(path, directory):
    path = os.path.realpath(path)
    directory = os.path.realpath(directory)

    relative = os.path.relpath(path, directory)

    if relative.startswith(os.pardir):
        return False
    else:
        return True
    
def get_all_users():
    users = {}
    for filename in os.listdir(user_dir):
        if filename.endswith('.json'):
            un = filename[:-5]  # Remove .json extension
            with open(os.path.join(user_dir, filename), 'r') as f:
                data = json.load(f)
                users[un] = {
                    "password": sha2(data["password"]),
                    "path": netdisk_rootdir + un,
                    "role": data["role"]
                }
    return json.dumps(users)

def create_user(un, password):
    if os.path.exists(user_dir + un + ".json"):
        return "用户已存在"
    
    try:
        # Create user json file
        user_data = {
            "password": password,
            "role": "normal"
        }
        with open(user_dir + un + ".json", "w") as f:
            json.dump(user_data, f)
        
        # Create user directory
        user_path = netdisk_rootdir + un
        if not os.path.exists(user_path):
            os.makedirs(user_path)
            
        return "用户创建成功"
    except Exception as e:
        return f"创建用户失败: {str(e)}"

def change_password(username, new_password):
    try:
        user_file = user_dir + username + ".json"
        if not os.path.exists(user_file):
            return "用户不存在"
            
        with open(user_file, "r") as f:
            user_data = json.load(f)
            
        user_data["password"] = new_password
        
        with open(user_file, "w") as f:
            json.dump(user_data, f)
            
        return "密码修改成功"
    except Exception as e:
        return f"修改密码失败: {str(e)}"

def change_role(un, new_role):
    if new_role not in ["normal", "vip", "admin"]:
        return "无效的角色类型"
    
    if un == username:
        return "不能修改自己的权限"
    
    if getUserPermission(un) == "admin":
        return "不能更改管理员的权限"
        
    try:
        user_file = user_dir + un + ".json"
        if not os.path.exists(user_file):
            return "用户不存在"
            
        with open(user_file, "r") as f:
            user_data = json.load(f)
            
        user_data["role"] = new_role
        
        with open(user_file, "w") as f:
            json.dump(user_data, f)
            
        return "用户权限修改成功"
    except Exception as e:
        return f"修改权限失败: {str(e)}"
    
def delete_user(un):
    # 检查用户是否存在
    user_file = user_dir + un + ".json"
    if not os.path.exists(user_file):
        return "用户不存在"
    
    # 检查是否为管理员账号
    if getUserPermission(un) == "admin":
            return "不能删除管理员或你自己的账号"
    
    try:
        # 删除用户目录
        user_path = netdisk_rootdir + un
        if not is_subdir(user_path, netdisk_rootdir):
            return "非法目录"
        
        if os.path.exists(user_path):
            import shutil
            shutil.rmtree(user_path)
        
        # 删除用户配置文件
        os.remove(user_file)
        return "用户删除成功"
    except Exception as e:
        return f"删除失败：{str(e)}"

# Main request handler
request_type = _GET.get("type")
dstUser = _GET.get("user")
password = _GET.get("pwd")
role = _GET.get("role")

if not checkCookie():
    print("You have to login first.")
else:

    if not getUserPermission(username) == "admin":
        print("You dont have permission to view this page. Your user group is: " + getUserPermission(username))
    else:
        if request_type == "alluser":
            print(get_all_users())
        elif request_type == "create":
            print(create_user(dstUser, password))
        elif request_type == "changepwd":
            print(change_password(dstUser, password))
        elif role:  # Change role request
            print(change_role(dstUser, role))
        elif _GET.get('type') == 'deleteuser':
            print(delete_user(_GET.get('user', '')))
        else:
            print("Invalid request type")
