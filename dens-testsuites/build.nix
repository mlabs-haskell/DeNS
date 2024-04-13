# TODO(jaredponn): put the entire thing (services, cardano, databases, clis) glued together for test suites
_:
{
  imports =
    [
      ./test-vm/build.nix
      ./integration/build.nix
    ];
}
