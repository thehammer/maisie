import { describe, test, expect } from "bun:test";
import { generateSchedule, type ScheduleEpisode } from "./library-channels";

const makeEpisodes = (count: number, durationMs = 24 * 60 * 1000): ScheduleEpisode[] =>
  Array.from({ length: count }, (_, i) => ({
    title: `Episode ${i + 1}`,
    seasonNumber: Math.floor(i / 10) + 1,
    episodeNumber: (i % 10) + 1,
    durationMs,
    filePath: `/media/show/ep${i + 1}.mp4`,
  }));

const makeMovies = (count: number): ScheduleEpisode[] =>
  Array.from({ length: count }, (_, i) => ({
    title: `Movie ${i + 1} (${2020 + i})`,
    seasonNumber: 0,
    episodeNumber: 0,
    durationMs: (90 + i * 10) * 60 * 1000, // 90m, 100m, 110m...
    filePath: `/media/movies/movie${i + 1}.mp4`,
  }));

describe("generateSchedule", () => {
  test("generates continuous episodes for a time window", () => {
    const episodes = makeEpisodes(10, 30 * 60 * 1000); // 30 min each
    const start = new Date("2026-03-30T00:00:00Z");
    const end = new Date("2026-03-30T04:00:00Z"); // 4 hours = 8 episodes

    const schedule = generateSchedule(episodes, "marathon", 0, start, end);

    expect(schedule.length).toBe(8);
    expect(schedule[0].startTime).toBeLessThanOrEqual(Math.floor(start.getTime() / 1000));
    expect(schedule[schedule.length - 1].endTime).toBeGreaterThanOrEqual(Math.floor(end.getTime() / 1000));
  });

  test("episodes are contiguous with no gaps", () => {
    const episodes = makeEpisodes(5, 20 * 60 * 1000);
    const start = new Date("2026-03-30T00:00:00Z");
    const end = new Date("2026-03-30T02:00:00Z");

    const schedule = generateSchedule(episodes, "marathon", 0, start, end);

    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].startTime).toBe(schedule[i - 1].endTime);
    }
  });

  test("loops when episode list is exhausted", () => {
    const episodes = makeEpisodes(3, 60 * 60 * 1000); // 3 eps, 1h each = 3h cycle
    const start = new Date("2026-03-30T00:00:00Z");
    const end = new Date("2026-03-30T06:00:00Z"); // 6 hours = 2 full cycles

    const schedule = generateSchedule(episodes, "marathon", 0, start, end);

    expect(schedule.length).toBe(6);
    // Episodes should repeat: 1,2,3,1,2,3
    expect(schedule[0].title).toBe(schedule[3].title);
    expect(schedule[1].title).toBe(schedule[4].title);
    expect(schedule[2].title).toBe(schedule[5].title);
  });

  test("is deterministic — same input produces same output", () => {
    const episodes = makeEpisodes(20);
    const start = new Date("2026-03-30T12:00:00Z");
    const end = new Date("2026-03-30T18:00:00Z");

    const a = generateSchedule(episodes, "marathon", 0, start, end);
    const b = generateSchedule(episodes, "marathon", 0, start, end);

    expect(a).toEqual(b);
  });

  test("movies get title as episodeTitle, not S00E00", () => {
    const movies = makeMovies(3);
    const start = new Date("2026-03-30T00:00:00Z");
    const end = new Date("2026-03-31T00:00:00Z");

    const schedule = generateSchedule(movies, "marathon", 0, start, end);

    for (const entry of schedule) {
      expect(entry.episodeTitle).not.toBe("S00E00");
      expect(entry.episodeTitle).toBe(entry.title);
    }
  });

  test("TV episodes get SxxExx episodeTitle", () => {
    const episodes = makeEpisodes(5);
    const start = new Date("2026-03-30T00:00:00Z");
    const end = new Date("2026-03-30T04:00:00Z");

    const schedule = generateSchedule(episodes, "marathon", 0, start, end);

    for (const entry of schedule) {
      expect(entry.episodeTitle).toMatch(/^S\d{2}E\d{2}$/);
    }
  });

  test("mixed playlist (movies + episodes) formats correctly", () => {
    const mixed: ScheduleEpisode[] = [
      { title: "A New Hope (1977)", seasonNumber: 0, episodeNumber: 0, durationMs: 120 * 60 * 1000, filePath: "/f.mp4" },
      { title: "Ambush", seasonNumber: 1, episodeNumber: 1, durationMs: 22 * 60 * 1000, filePath: "/f.mp4" },
      { title: "Rising Malevolence", seasonNumber: 1, episodeNumber: 2, durationMs: 22 * 60 * 1000, filePath: "/f.mp4" },
    ];
    const start = new Date("2026-03-30T00:00:00Z");
    const end = new Date("2026-03-30T12:00:00Z");

    const schedule = generateSchedule(mixed, "marathon", 0, start, end);

    const movieEntries = schedule.filter((e) => e.seasonNumber === 0 && e.episodeNumber === 0);
    const episodeEntries = schedule.filter((e) => e.seasonNumber > 0);

    // Movies should have title as episodeTitle
    for (const m of movieEntries) {
      expect(m.episodeTitle).toBe(m.title);
    }
    // Episodes should have SxxExx
    for (const e of episodeEntries) {
      expect(e.episodeTitle).toMatch(/^S\d{2}E\d{2}$/);
    }
  });

  test("returns empty for no episodes", () => {
    const start = new Date("2026-03-30T00:00:00Z");
    const end = new Date("2026-03-30T04:00:00Z");

    const schedule = generateSchedule([], "marathon", 0, start, end);
    expect(schedule).toEqual([]);
  });

  test("shuffle mode produces different order than marathon", () => {
    const episodes = makeEpisodes(20, 30 * 60 * 1000);
    const start = new Date("2026-03-30T00:00:00Z");
    const end = new Date("2026-03-30T12:00:00Z");

    const marathon = generateSchedule(episodes, "marathon", 42, start, end);
    const shuffle = generateSchedule(episodes, "shuffle", 42, start, end);

    // Same count but different order
    expect(shuffle.length).toBe(marathon.length);
    const marathonTitles = marathon.map((e) => e.title);
    const shuffleTitles = shuffle.map((e) => e.title);
    expect(shuffleTitles).not.toEqual(marathonTitles);
  });
});
