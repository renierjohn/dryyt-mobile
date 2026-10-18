import { faceProblem, type FaceBounds } from '../face-check';

const view = { width: 400, height: 800 };
/** A centered face half the view wide. */
const good: FaceBounds = { x: 100, y: 275, width: 200, height: 250 };

describe('faceProblem', () => {
  it('accepts one centered face', () => {
    expect(faceProblem([good], view)).toBeNull();
  });

  it('needs exactly one face', () => {
    expect(faceProblem([], view)).toBe('Place your face inside the frame');
    expect(faceProblem([good, good], view)).toBe('Only one face, please');
  });

  it('checks size and position', () => {
    expect(faceProblem([{ x: 170, y: 370, width: 60, height: 75 }], view)).toBe('Move closer');
    expect(faceProblem([{ x: 0, y: 200, width: 360, height: 400 }], view)).toBe('Move back a little');
    expect(faceProblem([{ ...good, x: 0 }], view)).toBe('Center your face in the frame');
    expect(faceProblem([{ ...good, y: 50 }], view)).toBe('Center your face in the frame');
  });
});
