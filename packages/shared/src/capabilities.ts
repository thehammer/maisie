export interface CapabilityDefinition {
  name: string
  description: string
  /** Action names that MUST be present. Framework validates at boot. */
  requiredActions: string[]
  /** Action names that enhance the capability but are not required. */
  optionalActions?: string[]
}

export const CAPABILITIES = {
  'media-server': {
    name: 'media-server',
    description: 'A media library and streaming server (Plex, Jellyfin, Emby, etc.)',
    requiredActions: ['get_libraries', 'get_now_playing', 'get_recently_added'],
    optionalActions: ['search_media', 'get_stream_url'],
  },
  network: {
    name: 'network',
    description: 'Home network controller (UniFi, Eero, pfSense, etc.)',
    requiredActions: ['get_devices', 'get_wan_health'],
    optionalActions: ['block_device', 'unblock_device', 'get_topology'],
  },
  storage: {
    name: 'storage',
    description: 'Network-attached storage (Synology, QNAP, TrueNAS, etc.)',
    requiredActions: ['get_health', 'list_files'],
    optionalActions: ['get_download_url'],
  },
  camera: {
    name: 'camera',
    description: 'Security camera system (UniFi Protect, Frigate, etc.)',
    requiredActions: ['get_cameras', 'get_snapshot'],
    optionalActions: ['get_rtsp_url', 'get_recent_events'],
  },
  'smart-home': {
    name: 'smart-home',
    description: 'Smart home controller (Home Assistant, HomeKit, etc.)',
    requiredActions: ['get_entities', 'call_service'],
    optionalActions: ['get_entity'],
  },
  printer: {
    name: 'printer',
    description: '3D printer or other fabrication device',
    requiredActions: ['get_status'],
    optionalActions: ['pause_print', 'resume_print', 'cancel_print'],
  },
  'book-library': {
    name: 'book-library',
    description: 'Ebook or physical book library (Calibre, etc.)',
    requiredActions: ['search_books', 'get_book_count'],
    optionalActions: ['get_book', 'get_authors'],
  },
} as const satisfies Record<string, CapabilityDefinition>

export type CapabilityType = keyof typeof CAPABILITIES
