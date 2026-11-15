#pragma once
#include <stdint.h>
#include <stddef.h>
// Initial verified signal: EEC1 / PGN 61444, SPN 190, bytes 4-5 (1-based),
// Intel/little-endian, 0.125 rpm/bit. No ECU requests or writes.
inline bool tmmDecodeEngineRpm(uint32_t id, const uint8_t* data, size_t length,
                              bool extended, bool remote, uint8_t engineAddress,
                              double& rpm) {
  if (!extended || remote || id > 0x1FFFFFFFUL || length < 5 || length > 8 || !data) return false;
  if ((id & 0xFFU) != engineAddress) return false;
  uint32_t pgn = (id >> 8) & 0x3FFFFU;
  if (((id >> 16) & 0xFFU) < 240) pgn &= 0x3FF00U;
  if (pgn != 61444) return false;
  const uint16_t raw = uint16_t(data[3]) | (uint16_t(data[4]) << 8);
  if (raw >= 0xFB00U) return false; // Reserved/error/not-available ranges.
  rpm = raw * 0.125;
  return true;
}
