res1 = " ___       __   ________   _______  _________  ________  ___  ________  ___  __       \n|\\  \\     |\\  \\|\\   ___  \\|\\  ___ \\|\\___   ___\\\\   ___ \\|\\  \\|\\   ____\\|\\  \\|\\  \\     \n\\ \\  \\    \\ \\  \\ \\  \\\\ \\  \\ \\   __/\\|___ \\  \\_\\ \\  \\_|\\ \\ \\  \\ \\  \\___|\\ \\  \\/  /|_   \n \\ \\  \\  __\\ \\  \\ \\  \\\\ \\  \\ \\  \\_|/__  \\ \\  \\ \\ \\  \\ \\\\ \\ \\  \\ \\_____  \\ \\   ___  \\  \n  \\ \\  \\|\\__\\_\\  \\ \\  \\\\ \\  \\ \\  \\_|\\ \\  \\ \\  \\ \\ \\  \\_\\\\ \\ \\  \\|____|\\  \\ \\  \\\\ \\  \\ \n   \\ \\____________\\ \\__\\\\ \\__\\ \\_______\\  \\ \\__\\ \\ \\_______\\ \\__\\____\\_\\  \\ \\__\\\\ \\__\\\n    \\|____________|\\|__| \\|__|\\|_______|   \\|__|  \\|_______|\\|__|\\_________\\|__| \\|__|\n                                                                \\|_________|          \nPage created by PyWebServer|WNetdisk - By Himpq"
res2 = '██╗    ██╗███╗   ██╗███████╗████████╗██████╗ ██╗███████╗██╗  ██╗\n██║    ██║████╗  ██║██╔════╝╚══██╔══╝██╔══██╗██║██╔════╝██║ ██╔╝\n██║ █╗ ██║██╔██╗ ██║█████╗     ██║   ██║  ██║██║███████╗█████╔╝ \n██║███╗██║██║╚██╗██║██╔══╝     ██║   ██║  ██║██║╚════██║██╔═██╗ \n╚███╔███╔╝██║ ╚████║███████╗   ██║   ██████╔╝██║███████║██║  ██╗\n ╚══╝╚══╝ ╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═════╝ ╚═╝╚══════╝╚═╝  ╚═╝\n'
console.log(res1)

function getLowSize(str){
    i = parseInt(str);
    if(i>1024){ //kb
        if(i>1024*1024){ //mb
            if(i>1024*1024*1024){//gb
                if(i>1024*1024*1024*1024){ //tb
                    return (i/(1024*1024*1024*1024)).toFixed(2)+"TB";
                }
                return (i/(1024*1024*1024)).toFixed(2)+"GB";
            }
            return (i/(1024*1024)).toFixed(2)+"MB";
        }
        return (i/1024).toFixed(2)+"KB";
    }
    return i+"B";
}
SENDING = [];
function newCallback(callback, sendto, arg1, type, async){
    type = type ? type : "GET";
    async= async !== undefined ? async : true;

    if (window.XMLHttpRequest)
    {
        // IE7+, Firefox, Chrome, Opera, Safari 浏览器执行的代码
        xmlhttp=new XMLHttpRequest();
    }
    else
    {    
        //IE6, IE5 浏览器执行的代码
        xmlhttp=new ActiveXObject("Microsoft.XMLHTTP");
    }
    let ID = SENDING.length;
    SENDING.push(xmlhttp);
    
    xmlhttp.onreadystatechange=function()
    {
        // if(xmlhttp.readyState == 4 && xmlhttp.status == 300){
            callback(SENDING[ID].responseText, SENDING[ID], arg1);
        // }
        // console.log(SENDING[ID].readyState, SENDING[ID].status)
    };
    SENDING[ID].open(type, sendto, async);
    SENDING[ID].send();
}