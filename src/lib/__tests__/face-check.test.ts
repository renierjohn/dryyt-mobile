import { faceProblem, type DetectedFace } from '../face-check';

const view = { width: 400, height: 800 };
/** A centered, front-facing face half the view wide. */
const good: DetectedFace = {
  bounds: { x: 100, y: 275, width: 200, height: 250 },
  yawAngle: 0,
  pitchAngle: 0,
  rollAngle: 0,
  leftEyeOpenProbability: 0.9,
  rightEyeOpenProbability: 0.9,
};

describe('faceProblem', () => {
  it('accepts one centered, front-facing face', () => {
    expect(faceProblem([good], view)).toBeNull();
  });

  it('needs exactly one face', () => {
    expect(faceProblem([], view)).toBe('Place your face inside the frame');
    expect(faceProblem([good, good], view)).toBe('Only one face, please');
  });

  it('checks size and position', () => {
    expect(faceProblem([{ ...good, bounds: { x: 170, y: 370, width: 60, height: 75 } }], view)).toBe('Move closer');
    expect(faceProblem([{ ...good, bounds: { x: 0, y: 200, width: 360, height: 400 } }], view)).toBe('Move back a little');
    expect(faceProblem([{ ...good, bounds: { ...good.bounds, x: 0 } }], view)).toBe('Center your face in the frame');
    expect(faceProblem([{ ...good, bounds: { ...good.bounds, y: 50 } }], view)).toBe('Center your face in the frame');
  });

  it('rejects a turned or tilted head', () => {
    for (const angle of ['yawAngle', 'pitchAngle', 'rollAngle'] as const) {
      expect(faceProblem([{ ...good, [angle]: -20 }], view)).toBe('Look straight at the camera');
    }
  });

  it('rejects closed eyes, but not when the detector gave no estimate', () => {
    expect(faceProblem([{ ...good, leftEyeOpenProbability: 0.1 }], view)).toBe('Keep your eyes open');
    expect(faceProblem([{ ...good, leftEyeOpenProbability: undefined, rightEyeOpenProbability: undefined }], view)).toBeNull();
  });
});
