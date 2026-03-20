export type RoomType = "normal" | "dataA" | "dataB" | "dataC" | "center";

export type Room = {
  id: string;
  label: string;
  type: RoomType;
  x: number;
  y: number;
  neighbors: string[];
  flavor?: string;
  isStart?: boolean;
};

export const rooms: Room[] = [
  { id: "R1", label: "외곽-1", type: "normal", x: 0, y: 0, neighbors: ["R2", "R5"], isStart: true, flavor: "벽 너머로 바람이 샌다." },
  { id: "R2", label: "외곽-2", type: "normal", x: 1, y: 0, neighbors: ["R1", "R3", "R6"], isStart: true, flavor: "낡은 철판이 미세하게 울린다." },
  { id: "R3", label: "A 구역", type: "dataA", x: 2, y: 0, neighbors: ["R2", "R4", "R7"], flavor: "깨진 단말기 잔해가 흩어져 있다." },
  { id: "R4", label: "외곽-4", type: "normal", x: 3, y: 0, neighbors: ["R3", "R8"], isStart: true, flavor: "멀리서 금속성 울림이 번진다." },

  { id: "R5", label: "서쪽 하단", type: "normal", x: 0, y: 1, neighbors: ["R1", "R6", "R9"], isStart: true, flavor: "환풍구 안 공기가 차갑다." },
  { id: "R6", label: "중간-1", type: "normal", x: 1, y: 1, neighbors: ["R2", "R5", "R7", "R10"], flavor: "몸을 움직일 때마다 강철이 웅웅 울린다." },
  { id: "R7", label: "중앙", type: "center", x: 2, y: 1, neighbors: ["R3", "R6", "R8", "R11"], flavor: "탈출 장치가 중앙에 고정되어 있다." },
  { id: "R8", label: "동쪽 하단", type: "normal", x: 3, y: 1, neighbors: ["R4", "R7", "R12"], isStart: true, flavor: "낡은 배선이 발목에 스친다." },

  { id: "R9", label: "B 구역", type: "dataB", x: 0, y: 2, neighbors: ["R5", "R10"], flavor: "모니터가 죽은 채 어둠만 반사한다." },
  { id: "R10", label: "중간-2", type: "normal", x: 1, y: 2, neighbors: ["R6", "R9", "R11"], flavor: "환풍구 안에서 먼지가 흩날린다." },
  { id: "R11", label: "C 구역", type: "dataC", x: 2, y: 2, neighbors: ["R7", "R10", "R12"], flavor: "멀리서 케이블이 바닥을 긁는 듯하다." },
  { id: "R12", label: "외곽-12", type: "normal", x: 3, y: 2, neighbors: ["R8", "R11"], isStart: true, flavor: "정적이 길게 늘어진다." },
];

export const roomMap = Object.fromEntries(
  rooms.map((room) => [room.id, room])
) as Record<string, Room>;

export const startRooms = rooms
  .filter((room) => room.isStart)
  .map((room) => room.id);

export const corridorSegments = [
  { left: "R1", right: "R2", type: "h" },
  { left: "R2", right: "R3", type: "h" },
  { left: "R3", right: "R4", type: "h" },

  { left: "R5", right: "R6", type: "h" },
  { left: "R6", right: "R7", type: "h" },
  { left: "R7", right: "R8", type: "h" },

  { left: "R9", right: "R10", type: "h" },
  { left: "R10", right: "R11", type: "h" },
  { left: "R11", right: "R12", type: "h" },

  { left: "R1", right: "R5", type: "v" },
  { left: "R5", right: "R9", type: "v" },

  { left: "R2", right: "R6", type: "v" },
  { left: "R6", right: "R10", type: "v" },

  { left: "R3", right: "R7", type: "v" },
  { left: "R7", right: "R11", type: "v" },

  { left: "R4", right: "R8", type: "v" },
  { left: "R8", right: "R12", type: "v" },
] as const;