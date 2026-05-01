import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, RotateCcw, Music, Power, Activity, Zap } from 'lucide-react';

// --- constants ---
const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const CAMELOT_MAJOR: Record<string, string> = {
  'C': '8B', 'C#': '3B', 'D': '10B', 'D#': '5B', 'E': '12B', 'F': '7B', 
  'F#': '2B', 'G': '9B', 'G#': '4B', 'A': '11B', 'A#': '6B', 'B': '1B'
};

const CAMELOT_MINOR: Record<string, string> = {
  'C': '5A', 'C#': '12A', 'D': '7A', 'D#': '2A', 'E': '9A', 'F': '4A', 
  'F#': '11A', 'G': '6A', 'G#': '1A', 'A': '8A', 'A#': '3A', 'B': '10A'
};

const getAlphanumericKey = (keyName: string) => {
  const [note, type] = keyName.split(' ');
  return type === 'Major' ? CAMELOT_MAJOR[note] : CAMELOT_MINOR[note];
};

const pearsonCorrelation = (x: number[], y: number[]) => {
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b) / n;
  const meanY = y.reduce((a, b) => a + b) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const div = Math.sqrt(denX * denY);
  return div === 0 ? 0 : num / div;
};

export default function App() {
  const [bpm, setBpm] = useState<string | null>(null);
  const [detectedKey, setDetectedKey] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [confidence, setConfidence] = useState(0);
  const [isPulsing, setIsPulsing] = useState(false);
  const [scanningProgress, setScanningProgress] = useState(0);
  const [countdown, setCountdown] = useState(5);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const lastPeakTimeRef = useRef<number>(0);
  const peakHistoryRef = useRef<number[]>([]);
  const chromaBufferRef = useRef<number[][]>([]);
  const energyHistoryRef = useRef<number[]>([]);
  const analysisStartRef = useRef<number>(0);

  const toggleListening = async () => {
    if (isListening) {
      stopListening();
      return;
    }
    
    try {
      if (!audioContextRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioContextRef.current = new AudioContextClass();
      }
      
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = audioContextRef.current.createMediaStreamSource(stream);
      const analyser = audioContextRef.current.createAnalyser();
      
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      analyserRef.current = analyser;

      setIsListening(true);
      peakHistoryRef.current = [];
      chromaBufferRef.current = [];
      energyHistoryRef.current = [];
      analysisStartRef.current = Date.now();
      setScanningProgress(0);
      setCountdown(5);

      const bufferLength = analyser.frequencyBinCount;
      const freqData = new Uint8Array(bufferLength);
      const timeData = new Uint8Array(analyser.fftSize);
      
      const analyze = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(freqData);
        analyserRef.current.getByteTimeDomainData(timeData);

        // --- Visualizer (Transient Focused) ---
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const samples = energyHistoryRef.current.slice(-100);
            const w = canvas.width / 100;
            ctx.lineWidth = 1.5;
            
            samples.forEach((e, i) => {
              const h = (e / 255) * canvas.height;
              const x = i * w;
              // Highlight detected beats
              ctx.strokeStyle = e > 160 ? '#22d3ee' : 'rgba(255, 255, 255, 0.05)';
              ctx.beginPath();
              ctx.moveTo(x, canvas.height);
              ctx.lineTo(x, canvas.height - h);
              ctx.stroke();
            });
          }
        }

        // --- Improved BPM Logic (5s Autocorrelation) ---
        let energy = 0;
        const binSize = audioContextRef.current!.sampleRate / analyser.fftSize;
        const lowEnd = Math.floor(40 / binSize);
        const highEnd = Math.ceil(180 / binSize);
        for (let i = lowEnd; i <= highEnd; i++) energy += freqData[i];
        energy /= (highEnd - lowEnd + 1);

        // Store energy samples for autocorrelation (approx 50-60 samples per second)
        energyHistoryRef.current.push(energy);
        if (energyHistoryRef.current.length > 300) energyHistoryRef.current.shift();

        // Pulsing visual
        const recentEnergy = energyHistoryRef.current.slice(-10);
        const avgEnergy = recentEnergy.reduce((a, b) => a + b, 0) / recentEnergy.length;
        if (energy > Math.max(avgEnergy * 1.6, 150)) {
          const now = Date.now();
          if (now - lastPeakTimeRef.current > 250) {
            setIsPulsing(true);
            setTimeout(() => setIsPulsing(false), 80);
            lastPeakTimeRef.current = now;
          }
        }

        // Periodic Refresh (5s)
        const elapsed = (Date.now() - analysisStartRef.current) / 1000;
        setScanningProgress(Math.min((elapsed / 5) * 100, 100));
        setCountdown(Math.max(0, Math.ceil(5 - elapsed)));

        if (elapsed >= 5) {
          // Autocorrelation to find periodic peaks
          const buffer = energyHistoryRef.current;
          let bestLag = 0;
          let maxCorr = -1;
          
          // Lag range: 15 (240 BPM) to 100 (36 BPM)
          for (let lag = 15; lag < 100; lag++) {
            let corr = 0;
            for (let i = 0; i < buffer.length - lag; i++) {
              corr += buffer[i] * buffer[i + lag];
            }
            if (corr > maxCorr) {
              maxCorr = corr;
              bestLag = lag;
            }
          }
          
          if (bestLag > 0) {
            // Convert lag to BPM (samples are approx 1/55 seconds apart)
            const lagSeconds = bestLag * (5 / buffer.length);
            const rawBpm = 60 / lagSeconds;
            if (rawBpm > 30 && rawBpm < 240) {
              setBpm(rawBpm.toFixed(1));
            }
          }
          analysisStartRef.current = Date.now();
        }

        // --- Key Logic ---
        if (animationFrameRef.current! % 15 === 0) {
          const frameChroma = new Array(12).fill(0);
          for (let i = 10; i < bufferLength / 2; i++) {
            const freq = i * binSize;
            const noteIndex = Math.round(12 * Math.log2(freq / 440) + 69) % 12;
            if (noteIndex >= 0) frameChroma[noteIndex] += freqData[i];
          }
          chromaBufferRef.current.push(frameChroma);
          if (chromaBufferRef.current.length > 10) chromaBufferRef.current.shift();

          const aggChroma = new Array(12).fill(0);
          chromaBufferRef.current.forEach(c => c.forEach((v, idx) => aggChroma[idx] += v));
          
          let bestKey = '';
          let maxCorr = -Infinity;
          for (let i = 0; i < 12; i++) {
            const rotMaj = [...KS_MAJOR.slice(12 - i), ...KS_MAJOR.slice(0, 12 - i)];
            const rotMin = [...KS_MINOR.slice(12 - i), ...KS_MINOR.slice(0, 12 - i)];
            const cMaj = pearsonCorrelation(aggChroma, rotMaj);
            const cMin = pearsonCorrelation(aggChroma, rotMin);
            if (cMaj > maxCorr) { maxCorr = cMaj; bestKey = `${KEY_NAMES[i]} Major`; }
            if (cMin > maxCorr) { maxCorr = cMin; bestKey = `${KEY_NAMES[i]} Minor`; }
          }
          if (maxCorr > 0.45) {
            setDetectedKey(bestKey);
            setConfidence(Math.round(maxCorr * 100));
          }
        }
        animationFrameRef.current = requestAnimationFrame(analyze);
      };
      analyze();
    } catch (err) {
      console.error('Mic failed:', err);
      setIsListening(false);
    }
  };

  const stopListening = () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (audioContextRef.current) audioContextRef.current.suspend();
    setIsListening(false);
  };

  const reset = () => {
    setBpm(null);
    setConfidence(0);
    setDetectedKey(null);
    peakHistoryRef.current = [];
  };

  return (
    <div className="w-full min-h-screen bg-[#050608] text-white font-sans flex flex-col p-8 overflow-hidden touch-none">
      {/* HUD Background Decorations */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-full h-full opacity-20 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]"></div>
        <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] bg-cyan-500/10 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] bg-purple-500/10 rounded-full blur-[120px]"></div>
      </div>

      {/* Top Nav */}
      <nav className="relative z-10 flex justify-between items-center mb-8">
        <div className="flex flex-col">
          <span className="text-[10px] font-bold tracking-[0.4em] uppercase text-cyan-400">Tempo.Pulse</span>
          <span className="text-[8px] font-mono opacity-30 mt-0.5">EST. LINK 0x42A</span>
        </div>
        <button onClick={reset} className="p-3 bg-white/5 rounded-full border border-white/10 active:scale-90 transition-transform">
          <RotateCcw className="w-4 h-4 opacity-40" />
        </button>
      </nav>

      {/* Primary Display */}
      <main className="flex-1 flex flex-col items-center justify-center relative z-10">
        <div className="relative group flex items-center justify-center">
          {/* Signal Scope - Tailored for phone */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-40">
             <canvas 
               ref={canvasRef}
               width={300}
               height={100}
               className="w-full h-[80px]"
             />
          </div>

          <motion.div 
            animate={{ 
              scale: isPulsing ? 1.3 : 1,
              borderColor: isPulsing ? '#22d3ee' : 'rgba(34, 211, 238, 0.2)'
            }}
            transition={{ duration: 0.1 }}
            className={`absolute w-[280px] h-[280px] rounded-full border-[1px] transition-colors`}
          ></motion.div>
          
          <div className="text-center relative z-20">
            <AnimatePresence mode="wait">
              <motion.div 
                key={bpm ?? 'off'}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-[100px] font-black tracking-tighter leading-none flex items-baseline justify-center select-none"
              >
                {bpm ? bpm.split('.')[0] : '00'}
                <span className="text-3xl opacity-20 font-thin ml-1">.{bpm ? bpm.split('.')[1] : '0'}</span>
              </motion.div>
            </AnimatePresence>
            
            {isListening && (
              <div className="mt-4 flex flex-col items-center">
                 <div className="flex items-center gap-3 mb-2">
                    <span className="text-[10px] font-mono opacity-40 uppercase tracking-widest">Next Calc:</span>
                    <span className="text-cyan-400 font-bold font-mono text-xs">{countdown}s</span>
                 </div>
                 <div className="w-24 h-0.5 bg-white/5 rounded-full overflow-hidden">
                    <motion.div 
                      animate={{ width: `${scanningProgress}%` }}
                      transition={{ ease: "linear" }}
                      className="h-full bg-cyan-400"
                    />
                 </div>
              </div>
            )}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="mt-16 w-full max-w-sm grid grid-cols-2 gap-4">
          <div className="bg-white/5 border border-white/10 rounded-3xl p-5 flex flex-col gap-1 backdrop-blur-xl relative overflow-hidden">
             {isListening && (
               <motion.div 
                 animate={{ scaleY: isPulsing ? [1, 1.2, 1] : 1 }}
                 className="absolute left-0 top-0 bottom-0 w-1 bg-cyan-500/20"
               />
             )}
             <div className="flex items-center gap-2 mb-1">
                <Music className="w-3 h-3 text-cyan-400" />
                <span className="text-[9px] font-bold tracking-widest uppercase opacity-40">Key Profile</span>
             </div>
             <div className="flex flex-col gap-0.5 overflow-hidden">
                <span className="text-lg font-bold font-mono text-cyan-400 truncate leading-none">{detectedKey ? detectedKey.toUpperCase() : 'SCANNING...'}</span>
                <span className="text-[10px] font-mono opacity-40 uppercase tracking-tighter tabular-nums whitespace-nowrap">
                    {detectedKey ? `Camelot: ${getAlphanumericKey(detectedKey)}` : 'Syncing engine'}
                </span>
             </div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-3xl p-5 flex flex-col gap-1 backdrop-blur-xl">
             <div className="flex items-center gap-2 mb-1">
                <Activity className="w-3 h-3 text-cyan-400" />
                <span className="text-[9px] font-bold tracking-widest uppercase opacity-40">Accuracy</span>
             </div>
             <div className="flex flex-col gap-0.5">
                <span className="text-lg font-bold font-mono leading-none">{confidence}%</span>
                <span className="text-[10px] font-mono opacity-40 uppercase tracking-tighter">Confidence</span>
             </div>
          </div>
        </div>
      </main>

      {/* Footer Controls */}
      <footer className="relative z-10 mt-12 mb-8 flex flex-col items-center">
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={toggleListening}
          className={`w-28 h-28 rounded-full flex items-center justify-center transition-all relative ${isListening ? 'bg-cyan-500 shadow-[0_0_60px_rgba(34,211,238,0.4)]' : 'bg-white/5 border border-white/10'}`}
        >
          {isListening ? <Power className="w-10 h-10 text-white" /> : <Mic className="w-10 h-10 text-white opacity-40" />}
          
          <AnimatePresence>
            {isListening && (
              <motion.div 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1.4, opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 border border-cyan-400/30 rounded-full animate-ping"
              ></motion.div>
            )}
          </AnimatePresence>
        </motion.button>
        
        <div className="mt-8 flex items-center gap-6 opacity-20">
            <div className="flex items-center gap-1.5">
                <Zap className="w-3 h-3" />
                <span className="text-[8px] font-mono tracking-widest uppercase">FFT Optic</span>
            </div>
            <div className="h-1 w-1 rounded-full bg-white"></div>
            <div className="flex items-center gap-1.5">
                <Activity className="w-3 h-3" />
                <span className="text-[8px] font-mono tracking-widest uppercase">Latency 12ms</span>
            </div>
        </div>
      </footer>

      {/* Signal Bar Bottom Decor */}
      <div className="absolute bottom-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyan-500/40 to-transparent"></div>
    </div>
  );
}
