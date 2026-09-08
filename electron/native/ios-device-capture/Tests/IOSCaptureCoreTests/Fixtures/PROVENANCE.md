Synthetic 64x96 testsrc2 animation generated locally, with no user media.
Reproduction (FFmpeg with libx264, engineering test dependency only):

ffmpeg -f lavfi -i 'testsrc2=size=64x96:rate=10:duration=0.3' -c:v libx264 -profile:v baseline -bf 0 -g 30 -pix_fmt yuv420p -x264-params 'colorprim=bt709:transfer=bt709:colormatrix=bt709' -movflags +write_colr baseline.mov

The fixture is original synthetic test data, dedicated to CC0-1.0.
