#include <cassert>
#include <cmath>
#include "../integrations/esp32/TMM_Device/tmm_j1939.h"
int main() {
  uint8_t d[8] = {0,0,0,0xE0,0x2E,0,0,0}; double rpm=-1;
  assert(tmmDecodeEngineRpm(0x0CF00400,d,8,true,false,0,rpm)); assert(rpm==1500);
  assert(!tmmDecodeEngineRpm(0x0CF00401,d,8,true,false,0,rpm));
  assert(!tmmDecodeEngineRpm(0x0CF00400,d,4,true,false,0,rpm));
  assert(!tmmDecodeEngineRpm(0x0CF00400,d,8,false,false,0,rpm));
  assert(!tmmDecodeEngineRpm(0x0CF00400,d,8,true,true,0,rpm));
  assert(!tmmDecodeEngineRpm(0x0CFECA00,d,8,true,false,0,rpm));
  assert(!tmmDecodeEngineRpm(0x0CF00400,nullptr,8,true,false,0,rpm));
  d[3]=0xFF;d[4]=0xFF;assert(!tmmDecodeEngineRpm(0x0CF00400,d,8,true,false,0,rpm));
  d[3]=0;d[4]=0;assert(tmmDecodeEngineRpm(0x0CF00400,d,8,true,false,0,rpm));assert(rpm==0);
}
