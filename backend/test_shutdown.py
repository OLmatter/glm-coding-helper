import unittest

from backend.server import _stop_workers


class FakeQueue:
    def __init__(self):
        self.items = []

    def put(self, item):
        self.items.append(item)


class FakeProcess:
    def __init__(self, exits_on_join=True):
        self.alive = True
        self.exits_on_join = exits_on_join
        self.killed = False

    def is_alive(self):
        return self.alive

    def join(self, timeout=None):
        if self.exits_on_join:
            self.alive = False

    def kill(self):
        self.killed = True
        self.alive = False


class StopWorkersTest(unittest.TestCase):
    def test_uses_sentinels_for_normal_shutdown(self):
        yolo_process = FakeProcess()
        ocr_process = FakeProcess()
        yolo_queue = FakeQueue()
        ocr_queue = FakeQueue()

        _stop_workers([yolo_process], [ocr_process], [yolo_queue], ocr_queue)

        self.assertEqual(yolo_queue.items, [None])
        self.assertEqual(ocr_queue.items, [None])
        self.assertFalse(yolo_process.killed)
        self.assertFalse(ocr_process.killed)

    def test_kills_only_a_worker_that_does_not_exit(self):
        process = FakeProcess(exits_on_join=False)

        _stop_workers([process], [], [FakeQueue()], FakeQueue())

        self.assertTrue(process.killed)


if __name__ == "__main__":
    unittest.main()
