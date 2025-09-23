import { motion } from 'framer-motion';
import { FullVideoPlayer } from './FullVideoPlayer';

export const VideoPage = ({ videoUrl, onClose }) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-1 bg-gray-900/95 backdrop-blur-lg p-6 mb-4 overflow-y-auto"
    >
      <div className="h-full flex flex-col gap-6">
        {/* Video Player */}
        <div className="flex-grow">
          {videoUrl ? (
            <FullVideoPlayer src={videoUrl} onClose={onClose} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-lg">
              No video selected
            </div>
          )}
        </div>

        {/* Instructions */}
        {!videoUrl && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 text-center"
          >
            <h2 className="text-white text-lg font-medium mb-2">Ready to Generate a Video?</h2>
            <p className="text-gray-400">
              Use the input box below to ask for a video explanation. The AI will create a custom video based on your request.
            </p>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
};