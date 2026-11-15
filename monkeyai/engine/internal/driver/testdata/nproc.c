#define _GNU_SOURCE
#include <errno.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>

static void *hold(void *unused) { (void)unused; for (;;) pause(); return NULL; }
int main(void) {
    struct rlimit limit;
    if (getuid() != 1000 || getrlimit(RLIMIT_NPROC, &limit) || limit.rlim_cur != 64 || limit.rlim_max != 64) return 10;
    limit.rlim_cur = limit.rlim_max = 65;
    errno = 0;
    if (setrlimit(RLIMIT_NPROC, &limit) != -1 || errno != EPERM) return 11;
    pid_t children[80];
    int count = 0, failure = 0;
    for (; count < 80; count++) {
        pid_t pid = fork();
        if (pid == 0) { for (;;) pause(); }
        if (pid < 0) { failure = errno; break; }
        children[count] = pid;
    }
    for (int i = 0; i < count; i++) kill(children[i], SIGKILL);
    for (int i = 0; i < count; i++) waitpid(children[i], NULL, 0);
    if (count != 63 || failure != EAGAIN) { fprintf(stderr, "fork count=%d errno=%d\n", count, failure); return 12; }
    pid_t pid = fork();
    if (pid == 0) _exit(0);
    if (pid < 0) return 13;
    int status = 0;
    waitpid(pid, &status, 0);
    if (status != 0) return 14;
    pthread_t threads[80];
    count = 0; failure = 0;
    for (; count < 80; count++) { failure = pthread_create(&threads[count], NULL, hold, NULL); if (failure) break; }
    // 主进程退出时沙箱会回收全部阻塞线程；不依赖 pthread_cancel 的运行时实现。
    if (count != 63 || failure != EAGAIN) { fprintf(stderr, "thread count=%d errno=%d\n", count, failure); return 15; }
    puts("NPROC_OK: fork=63, threads=63, raise=EPERM, release=reusable");
    return 0;
}
