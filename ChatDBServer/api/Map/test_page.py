"""独立地图风格实验页；配置仍由现有登录接口提供。"""

from flask import Blueprint, render_template

map_test_bp = Blueprint('map_test', __name__)


@map_test_bp.get('/test/map')
def map_style_test():
    """返回不包含密钥的实验页，地图加载需要已有登录态。"""
    return render_template('test/map.html')
