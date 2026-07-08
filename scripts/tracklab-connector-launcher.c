#include <stdlib.h>
#include <unistd.h>

int main(void) {
  setenv("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin", 1);
  execl(
    "/bin/zsh",
    "zsh",
    "/Users/rinzellhicks/Documents/Playground/wattbike-bmx-race/scripts/tracklab-open-connector.zsh",
    (char *)0
  );
  return 1;
}
