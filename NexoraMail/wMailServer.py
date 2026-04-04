import os

from core.wMailServer import *  # noqa: F401,F403

if __name__ == "__main__":
    from core.wMailServer import main
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    main()
