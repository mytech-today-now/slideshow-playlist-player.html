export const EXPERIENCE_BENCHMARK_ITEM_COUNTS = Object.freeze([1000, 10000, 20000]);
export const EXPERIENCE_BENCHMARK_SCENARIOS = Object.freeze(['setting', 'list-entry', 'library-item']);

export function experienceBenchmarkRecordKey(record) {
  return record?.id ?? record?.key;
}

export function createExperienceBenchmarkFixture(itemCount) {
  const library = Array.from({ length: itemCount }, (_, index) => ({
    id: `media-${String(index + 1).padStart(6, '0')}`,
    name: `Synthetic Media ${String(index + 1).padStart(6, '0')}.jpg`,
    size: 480_000 + (index % 900_000),
    type: 'image',
    duration: null,
    metadata: {
      width: 1920,
      height: 1080,
      codec: 'jpeg',
      syntheticFixture: true
    },
    addedAt: 1_700_000_000_000 + index
  }));

  const playlistItems = library.slice(0, Math.ceil(itemCount / 4)).map((item, index) => ({
    id: item.id,
    addedAt: 1_700_100_000_000 + index,
    displayDuration: 4
  }));
  const slideshowItems = library.slice(Math.ceil(itemCount / 4), Math.ceil(itemCount / 2)).map((item, index) => ({
    id: item.id,
    addedAt: 1_700_200_000_000 + index,
    displayDuration: 5
  }));
  const settings = {
    key: 'global',
    projectName: 'Synthetic persistence benchmark',
    opacity: 0.5,
    masterVolume: 0.8,
    playbackModePlaylist: 'sequential',
    playbackModeSlideshow: 'sequential'
  };
  const activeSettings = { ...settings };
  delete activeSettings.key;
  const activeExperience = {
    id: 'experience-000001',
    name: 'Synthetic active experience',
    updatedAt: '2026-01-01T00:00:00.000Z',
    payload: {
      projectName: settings.projectName,
      settings: activeSettings,
      playlist: structuredClone(playlistItems),
      slideshow: structuredClone(slideshowItems)
    }
  };
  const experienceCount = Math.max(5, Math.ceil(itemCount / 100));
  const experiences = [activeExperience];
  for (let index = 2; index <= experienceCount; index += 1) {
    experiences.push({
      id: `experience-${String(index).padStart(6, '0')}`,
      name: `Synthetic experience ${index}`,
      updatedAt: '2026-01-01T00:00:00.000Z',
      payload: {
        projectName: `Synthetic experience ${index}`,
        settings: { opacity: 0.5, masterVolume: 0.8 },
        playlist: [{ id: library[(index - 1) % library.length].id, addedAt: index }],
        slideshow: []
      }
    });
  }

  return {
    library,
    dirHandles: Array.from({ length: Math.ceil(itemCount / 250) }, (_, index) => ({
      id: `directory-${String(index + 1).padStart(5, '0')}`,
      name: `Synthetic directory ${index + 1}`,
      addedAt: 1_700_300_000_000 + index
    })),
    experiences,
    playlist: [{ key: 'default', items: playlistItems, mode: 'sequential', index: 0 }],
    slideshow: [{ key: 'default', items: slideshowItems, mode: 'sequential', index: 0 }],
    settings: [settings]
  };
}

export function createExperienceBenchmarkScenario(fixture, scenario, sampleIndex = 0) {
  const recordsByStore = structuredClone(fixture);
  const active = recordsByStore.experiences.find(record => record.id === 'experience-000001');

  if (scenario === 'setting') {
    const opacity = 0.6 + (sampleIndex * 0.05);
    recordsByStore.settings[0].opacity = opacity;
    active.payload.settings.opacity = opacity;
  } else if (scenario === 'list-entry') {
    const displayDuration = 6 + sampleIndex;
    recordsByStore.playlist[0].items[0].displayDuration = displayDuration;
    active.payload.playlist[0].displayDuration = displayDuration;
  } else if (scenario === 'library-item') {
    recordsByStore.library[0].metadata.rating = sampleIndex + 1;
  } else {
    throw new TypeError(`Unknown synthetic benchmark scenario: ${scenario}`);
  }

  return recordsByStore;
}

export function experienceBenchmarkSnapshotCounts(recordsByStore) {
  return Object.fromEntries(Object.entries(recordsByStore).map(([storeName, records]) => [storeName, records.length]));
}

export function experienceBenchmarkPayloadBytes(recordsByStore) {
  return new TextEncoder().encode(JSON.stringify(recordsByStore)).byteLength;
}

export function experienceBenchmarkMergeEntryCount(...snapshots) {
  let total = 0;
  for (const storeName of Object.keys(snapshots[0] || {})) {
    const keys = new Set();
    for (const snapshot of snapshots) {
      for (const record of snapshot[storeName] || []) {
        const key = experienceBenchmarkRecordKey(record);
        if (key != null) keys.add(key);
      }
    }
    total += keys.size;
  }
  return total;
}

export function experienceBenchmarkSnapshotSummary(recordsByStore) {
  return {
    recordCountsByStore: experienceBenchmarkSnapshotCounts(recordsByStore),
    recordCount: Object.values(recordsByStore).reduce((total, records) => total + records.length, 0),
    payloadBytes: experienceBenchmarkPayloadBytes(recordsByStore)
  };
}
