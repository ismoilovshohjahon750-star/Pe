import { useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';
import type { DesktopWindow, PaintStroke } from '../../desktop/types.ts';

interface PaintAppProps {
  win: DesktopWindow;
  interactive: boolean;
  onAddStroke: (
    windowId: string,
    stroke: { color: string; width: number; points: Array<{ x: number; y: number }> },
  ) => void;
  onClear: (windowId: string) => void;
}

const COLORS = ['#0F172A', '#0078D4', '#DC2626', '#16A34A', '#D97706', '#7C3AED', '#0284C7'];

export function PaintApp({ win, interactive, onAddStroke, onClear }: PaintAppProps) {
  const paint = win.paint;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(paint?.activeColor || '#0078D4');
  const [brushSize, setBrushSize] = useState(paint?.brushSize || 4);
  const drawingRef = useRef<Array<{ x: number; y: number }> | null>(null);

  const strokes: PaintStroke[] = paint?.strokes || [];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const stroke of strokes) {
      if (stroke.points.length === 0) continue;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      if (stroke.points.length === 1) {
        ctx.lineTo(stroke.points[0].x + 0.1, stroke.points[0].y + 0.1);
      }
      ctx.stroke();
    }
  }, [strokes]);

  const getLocalCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = [getLocalCoords(e)];
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive || !drawingRef.current) return;
    const pt = getLocalCoords(e);
    drawingRef.current.push(pt);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && drawingRef.current.length >= 2) {
      const prev = drawingRef.current[drawingRef.current.length - 2];
      ctx.strokeStyle = color;
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
    }
  };

  const handlePointerUp = () => {
    if (!drawingRef.current) return;
    const pts = drawingRef.current;
    drawingRef.current = null;
    if (pts.length > 0) {
      onAddStroke(win.id, { color, width: brushSize, points: pts });
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-100 text-slate-900 text-xs">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                onClick={() => setColor(c)}
                className={`w-5 h-5 rounded-sm border ${
                  color === c ? 'ring-2 ring-[#0078D4] border-white' : 'border-slate-300'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <label className="flex items-center gap-1.5 ml-2 text-slate-600">
            <span>Size</span>
            <select
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="px-1.5 py-0.5 bg-white border border-slate-300 rounded text-xs"
            >
              <option value={2}>2px</option>
              <option value={4}>4px</option>
              <option value={8}>8px</option>
              <option value={14}>14px</option>
            </select>
          </label>
        </div>

        <button
          type="button"
          disabled={!interactive}
          onClick={() => onClear(win.id)}
          className="flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-50"
        >
          <Eraser className="w-3.5 h-3.5" />
          <span>Clear Canvas</span>
        </button>
      </div>

      <div className="flex-1 p-3 overflow-auto flex items-center justify-center bg-slate-200">
        <canvas
          ref={canvasRef}
          width={680}
          height={380}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="bg-white border border-slate-300 shadow-sm max-w-full max-h-full cursor-crosshair touch-none"
        />
      </div>
    </div>
  );
}
