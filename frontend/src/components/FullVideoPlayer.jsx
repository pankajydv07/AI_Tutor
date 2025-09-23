import { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export const FullVideoPlayer = ({ src, onClose }) => {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [showVolumeControl, setShowVolumeControl] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [quality, setQuality] = useState('auto');

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateTime = () => setCurrentTime(video.currentTime);
    const updateDuration = () => setDuration(video.duration);
    const handlePlayPause = () => setIsPlaying(!video.paused);

    video.addEventListener('timeupdate', updateTime);
    video.addEventListener('loadedmetadata', updateDuration);
    video.addEventListener('play', handlePlayPause);
    video.addEventListener('pause', handlePlayPause);

    return () => {
      video.removeEventListener('timeupdate', updateTime);
      video.removeEventListener('loadedmetadata', updateDuration);
      video.removeEventListener('play', handlePlayPause);
      video.removeEventListener('pause', handlePlayPause);
    };
  }, []);

  const togglePlay = () => {
    if (videoRef.current.paused) {
      videoRef.current.play();
    } else {
      videoRef.current.pause();
    }
  };

  const handleSeek = (e) => {
    const time = e.target.value;
    videoRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const handleVolumeChange = (e) => {
    const value = e.target.value;
    setVolume(value);
    videoRef.current.volume = value;
  };

  const handlePlaybackSpeedChange = (speed) => {
    setPlaybackSpeed(speed);
    videoRef.current.playbackRate = speed;
    setShowSettings(false);
  };

  const handleQualityChange = (newQuality) => {
    setQuality(newQuality);
    setShowSettings(false);
    // In a real implementation, you would switch video sources here
  };

  const formatTime = (time) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = src;
    link.download = 'video.mp4';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full"
        onClick={togglePlay}
      >
        Your browser does not support the video tag.
      </video>

      {/* Play/Pause Overlay */}
      <motion.div
        className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity cursor-pointer"
        onClick={togglePlay}
      >
        <motion.div
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          className="bg-white/10 backdrop-blur-sm p-4 rounded-full"
        >
          {!isPlaying ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
        </motion.div>
      </motion.div>

      {/* Controls Overlay */}
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
        {/* Timeline */}
        <div className="flex items-center gap-2 text-sm text-white mb-4">
          <span>{formatTime(currentTime)}</span>
          <input
            type="range"
            min="0"
            max={duration || 0}
            value={currentTime}
            onChange={handleSeek}
            className="flex-grow h-1.5 bg-gray-600 rounded-lg appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-pink-500 cursor-pointer"
          />
          <span>{formatTime(duration)}</span>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Volume Control */}
            <div className="relative">
              <motion.button
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                onClick={() => setShowVolumeControl(!showVolumeControl)}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              </motion.button>
              <AnimatePresence>
                {showVolumeControl && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="absolute bottom-full left-0 mb-2 p-3 bg-gray-800/90 backdrop-blur-sm rounded-lg shadow-lg"
                  >
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={volume}
                      onChange={handleVolumeChange}
                      className="w-32 h-1.5 bg-gray-600 rounded-lg appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-pink-500 cursor-pointer"
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Settings Button */}
            <div className="relative">
              <motion.button
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                onClick={() => setShowSettings(!showSettings)}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </motion.button>
              <AnimatePresence>
                {showSettings && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="absolute bottom-full right-0 mb-2 p-3 bg-gray-800/90 backdrop-blur-sm rounded-lg shadow-lg min-w-[200px]"
                  >
                    <div className="space-y-4">
                      {/* Playback Speed */}
                      <div>
                        <h3 className="text-white text-sm font-medium mb-2">Playback Speed</h3>
                        <div className="grid grid-cols-3 gap-2">
                          {[0.5, 1, 1.5, 2].map(speed => (
                            <button
                              key={speed}
                              onClick={() => handlePlaybackSpeedChange(speed)}
                              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                                playbackSpeed === speed
                                  ? 'bg-pink-500 text-white'
                                  : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'
                              }`}
                            >
                              {speed}x
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Quality */}
                      <div>
                        <h3 className="text-white text-sm font-medium mb-2">Quality</h3>
                        <div className="grid grid-cols-2 gap-2">
                          {['auto', '1080p', '720p', '480p'].map(q => (
                            <button
                              key={q}
                              onClick={() => handleQualityChange(q)}
                              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                                quality === q
                                  ? 'bg-pink-500 text-white'
                                  : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'
                              }`}
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Download Button */}
            <motion.button
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              onClick={handleDownload}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </motion.button>

            {/* Close Button */}
            <motion.button
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              onClick={onClose}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
};