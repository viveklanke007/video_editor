export interface VideoClipItem {
  id: string;
  name: string;
  videoUrl: string;
  timelineStart: number; // position on combined timeline (s)
  duration: number;      // timeline duration (s)
  trimStart: number;     // offset in source video (s)
  zoom: number;          // 1.0 (normal), 1.15 (subtle punch), 1.3 (dynamic zoom)
  speed: number;         // 0.75, 1.0, 1.25, 1.5, 2.0
  volume: number;        // 0 - 100
  transition: 'cut' | 'crossfade' | 'zoom-in' | 'dip-black';
}

export interface SubtitleItem {
  id: string;
  start: number;
  end: number;
  text: string;
}
