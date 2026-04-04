Array.prototype.removeByValue = function (val) {
    for (var i = 0; i < this.length; i++) {
      if (this[i] === val) {
        this.splice(i, 1);
        i--;
      }
    }
    return this;
}

wplayer = function(){
    this.PlayMusic = function(src){
        this.src = src;
        this.ele = document.createElement("video");
        this.ele.style.display = "none";
        this.ele.setAttribute("src", src)

        this.changeSource = function(src){
            this.pause();
            this.ele.setAttribute('src', src);
        }
        this.play = function(){
            this.ele.play();
        }
        this.pause = function(){
            this.ele.pause();
        }
        this.getVolume = function(){
            return this.ele.volume;
        }
        this.setVolume = function(i){
            this.ele.volume = i;
        }
        this.isPaused = function(){
            return this.ele.paused;
        }
        this.getPos = function(){
            return this.ele.currentTime;
        }
        this.setPos = function(pos){
            this.ele.currentTime = pos;
        }
        this.getDuration = function(){
            return this.ele.duration;
        }
        this.getBufferedSize = function(){
            try{
                return this.ele.buffered.end(this.ele.buffered.length - 1);
            }catch(e){
                return 0;
            }
        }
        this.posChangeEvent = function(callback, timeCheck){
            timeCheck = timeCheck?timeCheck:100;
            TH = this;
            handle = setInterval(function(){
                if(TH.getPos() !== TH.upPos){
                    TH.upPos = TH.getPos();
                    callback(TH.getPos());
                }
            }, timeCheck);
            this.eventsHandle.push(handle);
            return handle;
        }
        this.posEndedEvent = function(callback){
            this.events.push(callback);
        }
        this.clearEvent = function(handle){
            this.eventsHandle.removeByValue(handle);
            clearInterval(handle);
        }

        TH = this;
        this.ele.onended = function(){
            for(i=0;i<TH.events.length;i++){
                TH.events[i]();
            }
        }
        this.upPos = 0;
        this.eventsHandle = [];
        this.events = [];
    }
}

wplayer = new wplayer();


