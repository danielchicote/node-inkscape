/*global describe, it, __dirname, setTimeout*/
var expect = require('unexpected')
    .use(require('unexpected-stream'))
    .use(require('unexpected-sinon'));
var sinon = require('sinon');
var Inkscape = require('../lib/Inkscape');
var pathModule = require('path');
var fs = require('fs');

describe('Inkscape', function () {
    it('should detect the output format as png if -e or --export-png is specified', function () {
        expect(new Inkscape(['-e']).outputFormat, 'to equal', 'png');
        expect(new Inkscape(['--export-png']).outputFormat, 'to equal', 'png');
    });

    it('should detect the output format as pdf if -A or --export-pdf is specified', function () {
        expect(new Inkscape(['-A']).outputFormat, 'to equal', 'pdf');
        expect(new Inkscape(['--export-pdf']).outputFormat, 'to equal', 'pdf');
    });

    it('should detect the output format as eps if -E or --export-eps is specified', function () {
        expect(new Inkscape(['-E']).outputFormat, 'to equal', 'eps');
        expect(new Inkscape(['--export-eps']).outputFormat, 'to equal', 'eps');
    });

    it('should detect the output format as ps if -P or --export-ps is specified', function () {
        expect(new Inkscape(['-P']).outputFormat, 'to equal', 'ps');
        expect(new Inkscape(['--export-ps']).outputFormat, 'to equal', 'ps');
    });

    it('should detect the output format as svg if -l or --export-plain-svg is specified', function () {
        expect(new Inkscape(['-l']).outputFormat, 'to equal', 'svg');
        expect(new Inkscape(['--export-plain-svg']).outputFormat, 'to equal', 'svg');
    });

    it('the --export-plain-svg=<outputFileName> argument should be injected correctly when -l is specified', function () {
        expect(new Inkscape(['-l']).inkscapeArgs.some(function (inkscapeArg) {return /^--export-plain-svg=.*\.svg$/.test(inkscapeArg);}), 'to be truthy');
    });

    it('should produce a PNG when run without arguments', function () {
        var inkscape = new Inkscape();

        expect(inkscape.outputFormat, 'to equal', 'png');
        return expect(
            fs.createReadStream(pathModule.resolve(__dirname, 'test.svg')).pipe(inkscape),
            'to yield output satisfying when decoded as', 'binary', 'to match', /^\x89PNG/
        );
    });

    it('should not emit data events while paused', function () {
        var inkscape = new Inkscape();

        function fail() {
            throw new Error('Inkscape emitted data while it was paused!');
        }
        inkscape.pause();
        inkscape.on('data', fail).on('error', function () {
        });

        expect(inkscape.outputFormat, 'to equal', 'png');
        fs.createReadStream(pathModule.resolve(__dirname, 'test.svg')).pipe(inkscape);

        return expect.promise(function (run) {
            setTimeout(run(function () {
                inkscape.removeListener('data', fail);

                inkscape.resume();
                return expect(inkscape, 'to yield output satisfying', {
                    length: expect.it('to be greater than', 0)
                });
            }), 1000);
        });
    });

    it('should emit an error if an invalid image is processed', function (done) {
        var inkscape = new Inkscape();

        inkscape.on('error', function (err) {
            done();
        }).on('data', function (chunk) {
            done(new Error('Inkscape emitted data when an error was expected'));
        }).on('end', function (chunk) {
            done(new Error('Inkscape emitted end when an error was expected'));
        });

        inkscape.end(new Buffer('qwvopeqwovkqvwiejvq', 'utf-8'));
    });

    it('should emit a single error if an invalid command line is specified', function (done) {
        var inkscape = new Inkscape(['-vqve']),
            seenError = false;

        inkscape.on('error', function (err) {
            expect(inkscape.commandLine, 'to match', /inkscape --without-gui -vqve -e=.*?\.png .*?\.svg$/);
            if (seenError) {
                done(new Error('More than one error event was emitted'));
            } else {
                seenError = true;
                setTimeout(done, 100);
            }
        }).on('data', function (chunk) {
            done(new Error('inkscape emitted data when an error was expected'));
        }).on('end', function (chunk) {
            done(new Error('inkscape emitted end when an error was expected'));
        });

        inkscape.end(new Buffer('qwvopeqwovkqvwiejvq', 'utf-8'));
    });

    describe('#destroy', function () {
        describe('when called before the fs.WriteStream is created', function () {
            it('should not create the fs.WriteStream or launch the inkscape process', function () {
                var inkscape = new Inkscape();
                fs.createReadStream(pathModule.resolve(__dirname, 'test.svg')).pipe(inkscape);
                inkscape.destroy();
                return expect.promise(function (run) {
                    setTimeout(run(function () {
                        expect(inkscape, 'to satisfy', {
                            writeStream: expect.it('to be falsy'),
                            inkscapeProcess: expect.it('to be falsy')
                        });
                    }), 10);
                });
            });
        });

        describe('when called while the fs.WriteStream is active', function () {
            it('should abort the fs.WriteStream and remove the temporary file', function () {
                var inkscape = new Inkscape();
                fs.createReadStream(pathModule.resolve(__dirname, 'test.svg')).pipe(inkscape);

                return expect.promise(function (run) {
                    setTimeout(run(function waitForWriteStream() {
                        var writeStream = inkscape.writeStream;
                        if (inkscape.writeStream) {
                            inkscape.destroy();
                            expect(inkscape.writeStream, 'to be falsy');
                            sinon.spy(writeStream, 'end');
                            sinon.spy(writeStream, 'write');
                            setTimeout(run(function () {
                                expect([writeStream.end, writeStream.write], 'to have calls satisfying', []);
                            }), 10);
                        } else {
                            setTimeout(run(waitForWriteStream), 0);
                        }
                    }), 0);
                });
            });
        });

        describe('when called while the inkscape process is running', function () {
            it('should kill the inkscape process and remove the temporary file', function () {
                var inkscape = new Inkscape();
                fs.createReadStream(pathModule.resolve(__dirname, 'test.svg')).pipe(inkscape);

                sinon.spy(fs, 'unlink');
                return expect.promise(function (run) {
                    setTimeout(run(function waitForInkscapeProcess() {
                        var inkscapeProcess = inkscape.inkscapeProcess;
                        if (inkscape.inkscapeProcess) {
                            sinon.spy(inkscapeProcess, 'kill');
                            expect(inkscape.filesToCleanUp, 'to satisfy', [
                                expect.it('to be a string'),
                                expect.it('to be a string')
                            ]);
                            var filesToCleanUp = [].concat(inkscape.filesToCleanUp);
                            inkscape.destroy();
                            expect([inkscapeProcess.kill, fs.unlink], 'to have calls satisfying', function () {
                                inkscapeProcess.kill();
                                fs.unlink(filesToCleanUp[0], expect.it('to be a function'));
                                fs.unlink(filesToCleanUp[1], expect.it('to be a function'));
                            });
                            expect(inkscape.inkscapeProcess, 'to be falsy');
                        } else {
                            setTimeout(run(waitForInkscapeProcess), 0);
                        }
                    }), 0);
                }).finally(function () {
                    fs.unlink.restore();
                });
            });
        });

        describe('when called while streaming from the temporary output file', function () {
            it('should kill the inkscape process and remove the temporary output file', function () {
                var inkscape = new Inkscape();
                fs.createReadStream(pathModule.resolve(__dirname, 'test.svg')).pipe(inkscape);
                inkscape.pause();
                sinon.spy(fs, 'unlink');
                return expect.promise(function (run) {
                    setTimeout(run(function waitForReadStream() {
                        var readStream = inkscape.readStream;
                        if (readStream) {
                            sinon.spy(readStream, 'destroy');
                            expect(inkscape.inkscapeProcess, 'to be falsy');
                            expect(inkscape.filesToCleanUp, 'to satisfy', [
                                expect.it('to be a string'),
                                expect.it('to be a string')
                            ]);
                            var filesToCleanUp = [].concat(inkscape.filesToCleanUp);
                            inkscape.destroy();
                            expect([fs.unlink, readStream.destroy], 'to have calls satisfying', function () {
                                readStream.destroy();
                                fs.unlink(filesToCleanUp[0], expect.it('to be a function'));
                                fs.unlink(filesToCleanUp[1], expect.it('to be a function'));
                            });
                        } else {
                            setTimeout(run(waitForReadStream), 0);
                        }
                    }), 0);
                }).finally(function () {
                    fs.unlink.restore();
                });
            });
        });
    });

    // Doesn't seem to work on Travis, probably due to no X being installed
    if (!process.env.CI) {
        describe('when utilizing verbs', function () {
            it('should operate in GUI mode', function () {
                var inkscape = new Inkscape([
                    '--verb=EditDeselect',
                    '--select=layer9',
                    '--verb=SelectionUnion',
                    '--verb=EditDelete',
                    '--verb=FileSave',
                    '--verb=FileClose',
                    '--verb=FileQuit'
                ]);
                expect(inkscape.commandLine, 'not to contain', '--without-gui');
            });

            it('should treat the input file as the output file (assuming --verb=FileSave)', function () {
                var inkscape = new Inkscape([
                    '--verb=EditDeselect',
                    '--select=layer9',
                    '--verb=SelectionUnion',
                    '--verb=EditDelete',
                    '--verb=FileSave',
                    '--verb=FileClose',
                    '--verb=FileQuit'
                ]);

                return expect(
                    fs.createReadStream(pathModule.resolve(__dirname, 'test.svg')).pipe(inkscape),
                    'to yield output satisfying when decoded as', 'utf-8',
                    'to satisfy', expect.it('to begin with', '<?xml').and('to contain', '<svg').and('not to contain', 'layer9')
                );
            });
        });
    }
});
