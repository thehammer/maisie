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
    requiredActions: ['list_libraries', 'get_now_playing', 'list_recently_added'],
    optionalActions: ['search_media', 'stream_media'],
  },
  network: {
    name: 'network',
    description: 'Home network controller (UniFi, Eero, pfSense, etc.)',
    requiredActions: ['list_devices', 'get_wan_health'],
    optionalActions: ['invoke_block_device', 'invoke_unblock_device', 'get_topology'],
  },
  storage: {
    name: 'storage',
    description: 'Network-attached storage (Synology, QNAP, TrueNAS, etc.)',
    requiredActions: ['get_storage_health', 'list_volumes'],
    optionalActions: ['list_files', 'get_download_url'],
  },
  camera: {
    name: 'camera',
    description: 'Security camera system (UniFi Protect, Frigate, etc.)',
    requiredActions: ['list_cameras', 'get_snapshot'],
    optionalActions: ['stream_camera', 'list_camera_events'],
  },
  'smart-home': {
    name: 'smart-home',
    description: 'Smart home controller (Home Assistant, HomeKit, etc.)',
    requiredActions: ['list_entities', 'invoke_service'],
    optionalActions: ['get_entity', 'list_scenes'],
  },
  printer: {
    name: 'printer',
    description: '3D printer or other fabrication device',
    requiredActions: ['get_print_status'],
    optionalActions: ['invoke_pause_print', 'invoke_resume_print', 'invoke_cancel_print'],
  },
  'book-library': {
    name: 'book-library',
    description: 'Ebook or physical book library (Calibre, etc.)',
    requiredActions: ['list_books', 'get_book'],
    optionalActions: ['list_authors', 'get_book_count'],
  },
  'inkjet-printer': {
    name: 'inkjet-printer',
    description: 'Inkjet or laser printer monitored via Embedded Web Server (HP, Canon, Epson, etc.)',
    requiredActions: ['get_supply_levels', 'get_status'],
    optionalActions: ['get_usage'],
  },
} as const satisfies Record<string, CapabilityDefinition>

export type CapabilityType = keyof typeof CAPABILITIES
