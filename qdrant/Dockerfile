FROM busybox:1.36.1-glibc AS busybox

FROM qdrant/qdrant:latest

COPY --from=busybox /bin/busybox /bin/busybox
