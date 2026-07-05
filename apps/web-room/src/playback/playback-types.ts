export type PlaybackVideoElement = {
  src: string;
  load: () => void;
  removeAttribute: (name: string) => void;
};
