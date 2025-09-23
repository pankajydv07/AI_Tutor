import { Loader } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Leva } from "leva";
import { Experience } from "./components/Experience";
import { UI } from "./components/UI";
import "./styles/layout.css";

function App() {
  return (
    <div className="w-screen h-screen flex flex-col lg:flex-row">
      {/* Left Section - Avatar (1/3) */}
      <div className="w-full lg:w-1/3 h-[50vh] lg:h-full relative avatar-section">
        <Loader />
        <Leva hidden />
        <Canvas shadows camera={{ position: [0, 0, 1], fov: 30 }}>
          <Experience />
        </Canvas>
        <div className="absolute top-4 left-4 z-10">
          <UI showControls={true} showChat={false} />
        </div>
      </div>
      
      {/* Right Section - Chat Interface (2/3) */}
      <div className="w-full lg:w-2/3 h-[50vh] lg:h-full chat-section">
        <UI showControls={false} showChat={true} />
      </div>

      {/* Mobile Chat Interface */}
      <div className="fixed bottom-0 left-0 right-0 h-[50vh] lg:hidden bg-gray-900/95 z-50">
        <UI showControls={false} showChat={true} />
      </div>
    </div>
  );
}

export default App;
